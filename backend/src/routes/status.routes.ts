import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { env } from '../config/env.js';
import { isDatabaseReady } from '../config/db.js';
import { TransactionHistory } from '../models/TransactionHistory.js';
import { fetchRelayStatus } from '../lib/relayClient.js';
import { verifySource } from '../lib/swapVerification.js';

const router = Router();

type ChainKey = 'ethereum' | 'base' | 'bsc' | 'polygon' | 'monad' | 'robinhood' | 'arc';

const CHAIN_ID_BY_KEY: Record<ChainKey, number> = {
  ethereum: 1,
  base: 8453,
  bsc: 56,
  polygon: 137,
  monad: 143,
  robinhood: 4663,
  arc: 5042,
};

interface StatusResult {
  status: 'pending' | 'confirming' | 'bridging' | 'completed' | 'failed';
  substatus?: string;
  substatusCode?: string; // Raw LI.FI substatus code (for programmatic handling)
  sendingTxHash?: string; // Source-chain tx (same as the submitted hash for swaps)
  receivingTxHash?: string; // Destination-chain tx — only appears once bridge relays
  explorerLink?: string; // Destination tx link, or LI.FI cross-chain explorer
  lifiExplorerLink?: string; // LI.FI cross-chain explorer specifically
}

// ── LI.FI status: GET li.quest/v1/status?txHash=...&fromChain=...&toChain=...
// Per LI.FI docs: for same-chain swaps, fromChain and toChain MUST be identical,
// otherwise the endpoint returns NOT_FOUND for swap-only (non-bridge) txs.
async function fetchLiFiStatus(
  txHash: string,
  fromChainId: number,
  toChainId?: number
): Promise<StatusResult> {
  const params = new URLSearchParams({
    txHash,
    fromChain: String(fromChainId),
    toChain: String(toChainId ?? fromChainId),
  });

  const headers: Record<string, string> = {};
  if (env.LIFI_API_KEY) {
    headers['x-lifi-api-key'] = env.LIFI_API_KEY;
  }

  const response = await fetch(
    `${env.LIFI_API_BASE_URL}/status?${params.toString()}`,
    { headers }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`LI.FI status check failed (${response.status}): ${text}`);
  }

  const data = (await response.json()) as {
    status?: string;
    substatus?: string;
    substatusMessage?: string;
    sending?: { txHash?: string; txLink?: string };
    receiving?: { txHash?: string; txLink?: string };
    lifiExplorerLink?: string;
  };

  const lifiStatus = data.status?.toUpperCase();
  const subCode = data.substatus?.toUpperCase();

  let status: StatusResult['status'];
  if (lifiStatus === 'DONE' && data.sending?.txHash?.toLowerCase() === txHash.toLowerCase()) {
    status = 'completed';
  } else if (lifiStatus === 'FAILED' || lifiStatus === 'INVALID') {
    // INVALID per LI.FI docs = "hash isn't associated with the requested tool".
    // Treat as failure so the UI stops spinning.
    status = 'failed';
  } else if (lifiStatus === 'PENDING') {
    // Use PENDING substatus to disambiguate cross-chain stages:
    //   WAIT_SOURCE_CONFIRMATIONS  → still on source chain, "confirming"
    //   WAIT_DESTINATION_TRANSACTION → bridge relaying to destination, "bridging"
    //   REFUND_IN_PROGRESS           → terminal refund; treat as failed
    //   BRIDGE_NOT_AVAILABLE / CHAIN_NOT_AVAILABLE → still pending, show bridging
    if (subCode === 'WAIT_SOURCE_CONFIRMATIONS') {
      status = 'confirming';
    } else if (subCode === 'REFUND_IN_PROGRESS') {
      status = 'failed';
    } else {
      status = 'bridging';
    }
  } else if (lifiStatus === 'NOT_FOUND') {
    status = 'confirming';
  } else {
    status = 'pending';
  }

  return {
    status,
    // Prefer the human-readable substatusMessage when LI.FI returns one.
    substatus: data.substatusMessage ?? data.substatus,
    substatusCode: data.substatus,
    sendingTxHash: data.sending?.txHash,
    receivingTxHash: data.receiving?.txHash,
    explorerLink: data.receiving?.txLink ?? data.lifiExplorerLink,
    lifiExplorerLink: data.lifiExplorerLink,
  };
}

// ── Squid status: GET v2.api.squidrouter.com/v2/status?transactionId=...&fromChainId=...&toChainId=...
async function fetchSquidStatus(
  txHash: string,
  fromChainId: number,
  toChainId?: number,
  tracking?: { quoteId?: string; requestId?: string }
): Promise<StatusResult> {
  const params = new URLSearchParams({
    transactionId: txHash,
    fromChainId: String(fromChainId),
    toChainId: String(toChainId ?? fromChainId),
  });
  if (tracking?.quoteId) params.set('quoteId', tracking.quoteId);
  if (tracking?.requestId) params.set('requestId', tracking.requestId);

  const headers: Record<string, string> = {};
  if (env.SQUID_INTEGRATOR_ID) {
    headers['x-integrator-id'] = env.SQUID_INTEGRATOR_ID;
  }

  const response = await fetch(
    `${env.SQUID_API_BASE_URL}/v2/status?${params.toString()}`,
    { headers }
  );

  if (!response.ok) {
    const text = await response.text();
    if (response.status === 404 || text.includes('not_found')) {
      return {
        status: 'confirming',
        substatus: 'Waiting for Squid to detect the transaction.',
      };
    }
    throw new Error(`Squid status check failed (${response.status}): ${text}`);
  }

  const data = (await response.json()) as {
    squidTransactionStatus?: string;
    toChain?: { transactionId?: string };
  };

  const squidStatus = data.squidTransactionStatus?.toLowerCase();

  let status: StatusResult['status'];
  if (squidStatus === 'success') {
    status = 'completed';
  } else if (squidStatus === 'partial_success' || squidStatus === 'needs_gas') {
    status = 'failed';
  } else if (squidStatus === 'ongoing') {
    status = 'bridging';
  } else if (squidStatus === 'not_found') {
    status = 'confirming';
  } else {
    status = 'confirming';
  }

  return {
    status,
    substatus: data.squidTransactionStatus,
    receivingTxHash: data.toChain?.transactionId,
  };
}

async function persistTrackedStatus(record: any, result: StatusResult) {
  if (!record) return;
  const source = await verifySource(record.verification, record.txHash);
  if (source.status === 'failed') result.status = 'failed';
  else if (!source.sourceConfirmed) result.status = 'confirming';
  const status = result.status;
  const statusDetail = {
    status,
    substatus: result.substatus,
    substatusCode: result.substatusCode,
    receivingTxHash: result.receivingTxHash,
    explorerLink: result.explorerLink,
    checkedAt: new Date().toISOString(),
  };

  await TransactionHistory.updateOne(
    { _id: record._id, proofVersion: 1, status: { $nin: ['completed', 'failed'] } },
    { $set: { status, sourceConfirmed: source.sourceConfirmed, 'metadata.statusTracking': statusDetail } }
  );
}

router.get('/status', rateLimit({ windowMs: 60000, limit: 60, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many status checks. Please retry shortly.' } }), async (req, res) => {
  const txHash =
    typeof req.query.txHash === 'string' ? req.query.txHash : undefined;
  let provider =
    typeof req.query.provider === 'string'
      ? req.query.provider.toLowerCase()
      : undefined;
  let fromChainKey =
    typeof req.query.fromChain === 'string' ? req.query.fromChain : undefined;
  let toChainKey =
    typeof req.query.toChain === 'string' ? req.query.toChain : undefined;
  let quoteId =
    typeof req.query.quoteId === 'string' ? req.query.quoteId : undefined;
  let requestId =
    typeof req.query.requestId === 'string' ? req.query.requestId : undefined;

  if (!txHash || !provider) {
    return res
      .status(400)
      .json({ error: 'Missing required params: txHash, provider.' });
  }
  if (!/^0x[\da-fA-F]{64}$/.test(txHash) ||
      (fromChainKey && !Object.hasOwn(CHAIN_ID_BY_KEY, fromChainKey)) ||
      (toChainKey && !Object.hasOwn(CHAIN_ID_BY_KEY, toChainKey)) ||
      (quoteId && quoteId.length > 256) || (requestId && requestId.length > 256)) {
    return res.status(400).json({ error: 'Invalid transaction status request.' });
  }

  try {
  // Query parameters are display hints only. A recorded swap's settlement
  // provider, route and tracking IDs come exclusively from its issued proof.
  const record = isDatabaseReady() ? await TransactionHistory.findOne({ txHash: txHash.toLowerCase(), proofVersion: 1, ...(fromChainKey ? { fromChain: fromChainKey } : {}) }).select('+verification') : null;
  if (record) {
    provider = record.provider; fromChainKey = record.fromChain; toChainKey = record.toChain;
    quoteId = record.metadata?.quoteId; requestId = record.metadata?.requestId;
  }
  const fromChainId =
    fromChainKey && fromChainKey in CHAIN_ID_BY_KEY
      ? CHAIN_ID_BY_KEY[fromChainKey as ChainKey]
      : undefined;

  const toChainId =
    toChainKey && toChainKey in CHAIN_ID_BY_KEY
      ? CHAIN_ID_BY_KEY[toChainKey as ChainKey]
      : undefined;

    let result: StatusResult;

    if (provider === 'lifi' || provider === 'lifi-api') {
      result = await fetchLiFiStatus(txHash, fromChainId ?? 1, toChainId);
    } else if (provider === 'squid' || provider === 'squid-api') {
      result = await fetchSquidStatus(txHash, fromChainId ?? 1, toChainId, {
        quoteId,
        requestId,
      });
    } else if (provider === 'relay' || provider === 'relay-api') {
      if (!requestId || !fromChainId || !toChainId) return res.status(400).json({ error: 'Relay status requires requestId and both chains.' });
      result = await fetchRelayStatus(requestId, txHash, fromChainId, toChainId);
    } else {
      return res
        .status(400)
        .json({ error: `Unsupported provider: ${provider}` });
    }

    await persistTrackedStatus(record, result);
    return res.json(result);
  } catch (error) {
    return res.status(502).json({
      error: 'Status check is temporarily unavailable. Please retry.',
      status: 'pending',
    });
  }
});

export default router;
