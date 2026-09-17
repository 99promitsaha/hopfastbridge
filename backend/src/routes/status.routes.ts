import { Router } from 'express';
import { env } from '../config/env.js';

const router = Router();

type ChainKey = 'ethereum' | 'base' | 'bsc' | 'polygon' | 'monad';

const CHAIN_ID_BY_KEY: Record<ChainKey, number> = {
  ethereum: 1,
  base: 8453,
  bsc: 56,
  polygon: 137,
  monad: 143
};

interface StatusResult {
  status: 'pending' | 'confirming' | 'bridging' | 'completed' | 'failed';
  substatus?: string;
  substatusCode?: string;        // Raw LI.FI substatus code (for programmatic handling)
  sendingTxHash?: string;        // Source-chain tx (same as the submitted hash for swaps)
  receivingTxHash?: string;      // Destination-chain tx — only appears once bridge relays
  explorerLink?: string;         // Destination tx link, or LI.FI cross-chain explorer
  lifiExplorerLink?: string;     // LI.FI cross-chain explorer specifically
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
    toChain: String(toChainId ?? fromChainId)
  });

  const headers: Record<string, string> = {};
  if (env.LIFI_API_KEY) {
    headers['x-lifi-api-key'] = env.LIFI_API_KEY;
  }

  const response = await fetch(`${env.LIFI_API_BASE_URL}/status?${params.toString()}`, { headers });

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
  if (lifiStatus === 'DONE') {
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
    lifiExplorerLink: data.lifiExplorerLink
  };
}

// ── deBridge DLN status tracking.
//
// Flow (per https://docs.dln.trade/):
//   1. GET stats-api.dln.trade/api/Transactions/{txHash}/orderIds
//        → returns { orderIds: string[] } once the DLN indexer has seen the tx.
//   2. GET stats-api.dln.trade/api/Orders/{orderId}
//        → returns { status, ... } with one of:
//          None | Created | Fulfilled | SentUnlock | ClaimedUnlock
//          | SentOrderCancel | ClaimedOrderCancel | OrderCancelled
//
// Terminal success: Fulfilled / SentUnlock / ClaimedUnlock (dest tx landed,
// maker has been / is being unlocked on source).
// Terminal failure: OrderCancelled / SentOrderCancel / ClaimedOrderCancel
// (order cancelled → maker refunded on source, no destination delivery).
const DEBRIDGE_STATS_API = 'https://stats-api.dln.trade/api';

// Public read-only RPCs used only for tx-receipt lookups on same-chain swaps.
// No keys, no signing — if any of these flake, the poller falls back to
// "confirming" and retries.
const PUBLIC_RPC_BY_CHAIN_ID: Record<number, string> = {
  1: 'https://cloudflare-eth.com',
  8453: 'https://mainnet.base.org',
  56: 'https://bsc-dataseed.binance.org',
  137: 'https://polygon-rpc.com',
  143: 'https://testnet-rpc.monad.xyz'
};

/**
 * Check an EVM tx receipt via public JSON-RPC. Used by same-chain swap paths
 * where no cross-chain indexer has any knowledge of the tx — the receipt
 * itself is the authoritative source of truth.
 */
async function fetchEvmReceiptStatus(txHash: string, chainId: number): Promise<StatusResult> {
  const rpcUrl = PUBLIC_RPC_BY_CHAIN_ID[chainId];
  if (!rpcUrl) {
    // No RPC configured for this chain — keep the poller spinning on
    // "confirming" rather than hard-failing. The user will still see the
    // explorer link and can verify manually.
    return { status: 'confirming', substatus: 'Awaiting on-chain confirmation.' };
  }

  const rpcResponse = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_getTransactionReceipt',
      params: [txHash]
    })
  });

  if (!rpcResponse.ok) {
    return { status: 'confirming', substatus: 'Awaiting on-chain confirmation.' };
  }

  const body = (await rpcResponse.json()) as {
    result?: { status?: string; transactionHash?: string } | null;
  };

  // Result is null until the tx is mined. Keep polling.
  if (!body.result) {
    return { status: 'confirming', substatus: 'Transaction pending on-chain.' };
  }

  // status is a hex-encoded byte: 0x1 success, 0x0 revert.
  const receiptStatus = body.result.status?.toLowerCase();
  if (receiptStatus === '0x1') {
    return {
      status: 'completed',
      substatus: 'Swap confirmed on-chain.',
      sendingTxHash: txHash,
      receivingTxHash: txHash // same-chain swap: source == destination
    };
  }
  if (receiptStatus === '0x0') {
    return {
      status: 'failed',
      substatus: 'Transaction reverted on-chain.',
      sendingTxHash: txHash
    };
  }

  // Unknown status byte — keep polling rather than misreport a terminal state.
  return { status: 'confirming', substatus: 'Transaction mined, awaiting status.' };
}

async function fetchDebridgeStatus(
  txHash: string,
  fromChainId?: number,
  toChainId?: number
): Promise<StatusResult> {
  // Same-chain deBridge swaps hit `/v1.0/chain/transaction`, which does NOT
  // create a DLN order — so the stats-api indexer never sees them. Fall back
  // to a direct tx-receipt check; same-chain is "done" the moment the tx mines.
  if (fromChainId && toChainId && fromChainId === toChainId) {
    return fetchEvmReceiptStatus(txHash, fromChainId);
  }

  // Step 1: resolve orderId from source-chain txHash. The indexer can take
  // ~15-30s after tx confirmation to pick the order up.
  const orderIdsResponse = await fetch(
    `${DEBRIDGE_STATS_API}/Transactions/${txHash}/orderIds`
  );

  if (!orderIdsResponse.ok) {
    return { status: 'confirming', substatus: 'Transaction not yet indexed by deBridge.' };
  }

  const orderIdsData = (await orderIdsResponse.json()) as { orderIds?: string[] };
  const orderId = orderIdsData.orderIds?.[0];

  if (!orderId) {
    return { status: 'confirming', substatus: 'Waiting for deBridge to detect the order.' };
  }

  // Step 2: fetch order details.
  const orderResponse = await fetch(
    `${DEBRIDGE_STATS_API}/Orders/${orderId}`
  );

  if (!orderResponse.ok) {
    return { status: 'bridging', substatus: 'Order submitted, waiting for fulfillment.' };
  }

  const orderData = (await orderResponse.json()) as {
    status?: string;
    state?: string;
    fulfilledDstEventMetadata?: { transactionHash?: { stringValue?: string } | string };
    giveOfferWithMetadata?: { status?: string };
    takeOfferWithMetadata?: { status?: string };
  };

  // deBridge's API has evolved — accept both `status` and `state` keys.
  const dbStatus = (orderData.status ?? orderData.state ?? '').trim();

  let status: StatusResult['status'];
  switch (dbStatus) {
    case 'Fulfilled':
    case 'SentUnlock':
    case 'ClaimedUnlock':
      status = 'completed';
      break;
    case 'OrderCancelled':
    case 'Cancelled':
    case 'SentOrderCancel':
    case 'ClaimedOrderCancel':
      status = 'failed';
      break;
    case 'Created':
    case 'None':
    case '':
      status = 'bridging';
      break;
    default:
      // Unknown state — keep bridging so user sees progress rather than a stall.
      status = 'bridging';
      break;
  }

  // Destination tx hash may be a plain string or a protobuf-style {stringValue}.
  const rawDstHash = orderData.fulfilledDstEventMetadata?.transactionHash;
  const receivingTxHash =
    typeof rawDstHash === 'string'
      ? rawDstHash
      : rawDstHash?.stringValue;

  return {
    status,
    substatus: humanizeDebridgeStatus(dbStatus),
    substatusCode: dbStatus || undefined,
    sendingTxHash: txHash,
    receivingTxHash,
    explorerLink: `https://app.debridge.finance/order?orderId=${orderId}`
  };
}

function humanizeDebridgeStatus(dbStatus: string): string {
  switch (dbStatus) {
    case 'Created': return 'Order created — waiting for a solver to fulfil on the destination chain.';
    case 'Fulfilled': return 'Order fulfilled on destination chain.';
    case 'SentUnlock': return 'Fulfilled — unlocking maker funds on source chain.';
    case 'ClaimedUnlock': return 'Completed — maker unlock claimed.';
    case 'OrderCancelled':
    case 'Cancelled': return 'Order cancelled by deBridge — funds will be refunded on source chain.';
    case 'SentOrderCancel': return 'Cancelling order — refund en route to source chain.';
    case 'ClaimedOrderCancel': return 'Refund claimed on source chain.';
    case 'None': return 'Order registered, awaiting solver.';
    case '': return 'Order status unavailable yet.';
    default: return dbStatus;
  }
}

// ── Relay status: GET api.relay.link/requests/v2?hash=<txHash>&limit=1
// Relay indexes bridge requests by source tx hash. We look up the request and
// map its status to our internal StatusResult type.
async function fetchRelayStatus(txHash: string): Promise<StatusResult> {
  const response = await fetch(
    `https://api.relay.link/requests/v2?hash=${txHash}&limit=1`
  );

  if (!response.ok) {
    return { status: 'confirming', substatus: 'Waiting for Relay to index the transaction.' };
  }

  const data = (await response.json()) as {
    requests?: Array<{
      id?: string;
      status?: string;
      data?: {
        outTxs?: Array<{ hash?: string; chainId?: number }>;
        inTxs?: Array<{ hash?: string }>;
        failReason?: string;
      };
    }>;
  };

  const request = data.requests?.[0];
  if (!request) {
    return { status: 'confirming', substatus: 'Transaction not yet indexed by Relay.' };
  }

  const relayStatus = request.status?.toLowerCase();

  let status: StatusResult['status'];
  switch (relayStatus) {
    case 'success':
      status = 'completed';
      break;
    case 'failure':
    case 'refund':
      status = 'failed';
      break;
    case 'depositing':
      status = 'confirming';
      break;
    case 'pending':
    case 'waiting':
    default:
      status = 'bridging';
      break;
  }

  const receivingTx = request.data?.outTxs?.[0];
  return {
    status,
    substatus: relayStatus,
    substatusCode: request.status,
    sendingTxHash: request.data?.inTxs?.[0]?.hash ?? txHash,
    receivingTxHash: receivingTx?.hash,
    explorerLink: request.id
      ? `https://relay.link/transaction/${request.id}`
      : undefined,
  };
}

// ── Squid status: GET v2.api.squidrouter.com/v2/status?transactionId=...&fromChainId=...&toChainId=...
async function fetchSquidStatus(txHash: string, fromChainId: number, toChainId?: number): Promise<StatusResult> {
  const params = new URLSearchParams({
    transactionId: txHash,
    fromChainId: String(fromChainId),
    toChainId: String(toChainId ?? fromChainId)
  });

  const headers: Record<string, string> = {};
  if (env.SQUID_INTEGRATOR_ID) {
    headers['x-integrator-id'] = env.SQUID_INTEGRATOR_ID;
  }

  const response = await fetch(`${env.SQUID_API_BASE_URL}/v2/status?${params.toString()}`, { headers });

  if (!response.ok) {
    const text = await response.text();
    if (response.status === 404 || text.includes('not_found')) {
      return { status: 'confirming', substatus: 'Waiting for Squid to detect the transaction.' };
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
    receivingTxHash: data.toChain?.transactionId
  };
}

router.get('/status', async (req, res) => {
  const txHash = typeof req.query.txHash === 'string' ? req.query.txHash : undefined;
  const provider = typeof req.query.provider === 'string' ? req.query.provider.toLowerCase() : undefined;
  const fromChainKey = typeof req.query.fromChain === 'string' ? req.query.fromChain : undefined;
  const toChainKey = typeof req.query.toChain === 'string' ? req.query.toChain : undefined;

  if (!txHash || !provider) {
    return res.status(400).json({ error: 'Missing required params: txHash, provider.' });
  }

  const fromChainId = fromChainKey && fromChainKey in CHAIN_ID_BY_KEY
    ? CHAIN_ID_BY_KEY[fromChainKey as ChainKey]
    : undefined;

  const toChainId = toChainKey && toChainKey in CHAIN_ID_BY_KEY
    ? CHAIN_ID_BY_KEY[toChainKey as ChainKey]
    : undefined;

  try {
    let result: StatusResult;

    if (provider === 'lifi' || provider === 'lifi-api') {
      result = await fetchLiFiStatus(txHash, fromChainId ?? 1, toChainId);
    } else if (provider === 'debridge' || provider === 'debridge-api') {
      result = await fetchDebridgeStatus(txHash, fromChainId, toChainId);
    } else if (provider === 'squid' || provider === 'squid-api') {
      result = await fetchSquidStatus(txHash, fromChainId ?? 1, toChainId);
    } else if (provider === 'relay' || provider === 'relay-api') {
      result = await fetchRelayStatus(txHash);
    } else {
      return res.status(400).json({ error: `Unsupported provider: ${provider}` });
    }

    return res.json(result);
  } catch (error) {
    return res.status(502).json({
      error: error instanceof Error ? error.message : 'Status check failed.',
      status: 'pending'
    });
  }
});

export default router;
