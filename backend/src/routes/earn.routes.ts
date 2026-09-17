import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { env } from '../config/env.js';
import { EarnPosition } from '../models/EarnPosition.js';
import { EarnPreference } from '../models/EarnPreference.js';
import { isDatabaseReady } from '../config/db.js';

const router = Router();
const EARN_API = 'https://earn.li.fi';

function lifiHeaders(): Record<string, string> {
  if (!env.LIFI_API_KEY) throw new Error('LIFI_API_KEY is required for earn.li.fi requests.');
  return { 'x-lifi-api-key': env.LIFI_API_KEY };
}

const earnLimiter = rateLimit({
  windowMs: 60_000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => env.NODE_ENV === 'development',
  message: { error: 'Too many requests. Please wait a moment.' }
});


router.get('/earn/vaults', earnLimiter, async (req, res) => {
  try {
    const qs = new URLSearchParams();
    const allowed = ['chainId', 'asset', 'protocol', 'minTvlUsd', 'sortBy', 'cursor', 'limit'];
    for (const key of allowed) {
      const val = req.query[key];
      if (typeof val === 'string' && val.length > 0) {
        qs.set(key, val);
      }
    }

    const apiRes = await fetch(`${EARN_API}/v1/vaults?${qs}`, { headers: lifiHeaders() });
    const text = await apiRes.text();

    if (!apiRes.ok) {
      return res.status(apiRes.status).json({ error: 'Failed to fetch vaults from upstream.' });
    }

    return res.json(JSON.parse(text));
  } catch {
    return res.status(502).json({ error: 'Failed to fetch vaults.' });
  }
});


router.get('/earn/chains', earnLimiter, async (_req, res) => {
  try {
    const apiRes = await fetch(`${EARN_API}/v1/chains`, { headers: lifiHeaders() });
    const text = await apiRes.text();
    if (!apiRes.ok) return res.status(apiRes.status).json({ error: 'Failed to fetch chains.' });
    return res.json(JSON.parse(text));
  } catch {
    return res.status(502).json({ error: 'Failed to fetch chains.' });
  }
});


router.get('/earn/protocols', earnLimiter, async (_req, res) => {
  try {
    const apiRes = await fetch(`${EARN_API}/v1/protocols`, { headers: lifiHeaders() });
    const text = await apiRes.text();
    if (!apiRes.ok) return res.status(apiRes.status).json({ error: 'Failed to fetch protocols.' });
    return res.json(JSON.parse(text));
  } catch {
    return res.status(502).json({ error: 'Failed to fetch protocols.' });
  }
});


router.get('/earn/portfolio/:address/positions', earnLimiter, async (req, res) => {
  const { address } = req.params;
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
    return res.status(400).json({ error: 'Invalid wallet address.' });
  }
  try {
    const apiRes = await fetch(`${EARN_API}/v1/portfolio/${address}/positions`, { headers: lifiHeaders() });
    const text = await apiRes.text();
    if (!apiRes.ok) return res.status(apiRes.status).json({ error: 'Failed to fetch live positions.' });
    return res.json(JSON.parse(text));
  } catch {
    return res.status(502).json({ error: 'Failed to fetch live positions.' });
  }
});


router.get('/earn/preferences/:address', earnLimiter, async (req, res) => {
  const { address } = req.params;
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
    return res.status(400).json({ error: 'Invalid wallet address.' });
  }
  if (!isDatabaseReady()) return res.json({ preference: null });
  const preference = await EarnPreference.findOne({ userAddress: address.toLowerCase() }).lean();
  return res.json({ preference: preference ?? null });
});


router.post('/earn/preferences', earnLimiter, async (req, res) => {
  const { userAddress, riskAppetite, preferredAsset, experienceLevel } = req.body ?? {};
  if (!userAddress || !/^0x[0-9a-fA-F]{40}$/.test(userAddress)) {
    return res.status(400).json({ error: 'Invalid wallet address.' });
  }
  if (!['high', 'safe'].includes(riskAppetite)) {
    return res.status(400).json({ error: 'Invalid riskAppetite.' });
  }
  if (!['beginner', 'intermediate', 'advanced'].includes(experienceLevel)) {
    return res.status(400).json({ error: 'Invalid experienceLevel.' });
  }
  if (!isDatabaseReady()) return res.status(503).json({ error: 'Database unavailable.' });

  const preference = await EarnPreference.findOneAndUpdate(
    { userAddress: userAddress.toLowerCase() },
    { riskAppetite, preferredAsset: preferredAsset ?? 'any', experienceLevel },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  return res.status(201).json({ preference });
});


router.get('/earn/positions/:address', earnLimiter, async (req, res) => {
  try {
    const address = req.params.address;
    if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
      return res.status(400).json({ error: 'Invalid wallet address.' });
    }
    if (!isDatabaseReady()) {
      return res.json({ positions: [] });
    }
    const positions = await EarnPosition.find({
      userAddress: address.toLowerCase(),
    }).sort({ createdAt: -1 }).lean();
    return res.json({ positions });
  } catch {
    return res.status(500).json({ error: 'Failed to fetch positions.' });
  }
});


router.post('/earn/positions', earnLimiter, async (req, res) => {
  try {
    if (!isDatabaseReady()) {
      return res.status(503).json({ error: 'Database unavailable.' });
    }

    const ethAddrRe = /^0x[0-9a-fA-F]{40}$/;
    const {
      userAddress, vaultAddress, vaultName, chainId, network,
      protocolName, protocolUrl, tokenSymbol, tokenAddress, tokenDecimals,
      amount, amountRaw, txHash, action,
    } = req.body;

    if (!userAddress || !ethAddrRe.test(userAddress)) {
      return res.status(400).json({ error: 'Invalid user address.' });
    }
    if (!vaultAddress || !ethAddrRe.test(vaultAddress)) {
      return res.status(400).json({ error: 'Invalid vault address.' });
    }
    if (!txHash || typeof txHash !== 'string') {
      return res.status(400).json({ error: 'Missing txHash.' });
    }

    const position = await EarnPosition.create({
      userAddress: userAddress.toLowerCase(),
      vaultAddress: vaultAddress.toLowerCase(),
      vaultName: vaultName ?? '',
      chainId: Number(chainId),
      network: network ?? '',
      protocolName: protocolName ?? '',
      protocolUrl: protocolUrl ?? '',
      tokenSymbol: tokenSymbol ?? '',
      tokenAddress: (tokenAddress ?? '').toLowerCase(),
      tokenDecimals: Number(tokenDecimals ?? 18),
      amount: amount ?? '0',
      amountRaw: amountRaw ?? '0',
      txHash: txHash.toLowerCase(),
      action: action ?? 'deposit',
    });

    return res.status(201).json({ position });
  } catch {
    return res.status(500).json({ error: 'Failed to save position.' });
  }
});


router.delete('/earn/positions/:id', earnLimiter, async (req, res) => {
  try {
    if (!isDatabaseReady()) {
      return res.status(503).json({ error: 'Database unavailable.' });
    }
    const result = await EarnPosition.findByIdAndDelete(req.params.id);
    if (!result) {
      return res.status(404).json({ error: 'Position not found.' });
    }
    return res.json({ success: true });
  } catch {
    return res.status(500).json({ error: 'Failed to delete position.' });
  }
});


router.post('/earn/quote', earnLimiter, async (req, res) => {
  try {
    const {
      srcTokenAddress,
      dstTokenAddress,
      srcWalletAddress,
      dstWalletAddress,
      amount,
      srcChainId,
      dstChainId,
    } = req.body;

    if (!srcTokenAddress || !dstTokenAddress || !amount || !srcChainId) {
      return res.status(400).json({ error: 'Missing required fields.' });
    }

    const ethAddrRe = /^0x[0-9a-fA-F]{40}$/;
    if (!ethAddrRe.test(srcTokenAddress) || !ethAddrRe.test(dstTokenAddress)) {
      return res.status(400).json({ error: 'Invalid token address format.' });
    }
    if (typeof amount !== 'string' || !/^\d+$/.test(amount)) {
      return res.status(400).json({ error: 'Amount must be a numeric string.' });
    }
    if (srcWalletAddress && !ethAddrRe.test(srcWalletAddress)) {
      return res.status(400).json({ error: 'Invalid wallet address.' });
    }

    const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
    const fromAddress = srcWalletAddress ?? ZERO_ADDRESS;
    const toAddress = dstWalletAddress ?? srcWalletAddress ?? ZERO_ADDRESS;

    const params = new URLSearchParams({
      fromChain: String(srcChainId),
      toChain: String(dstChainId ?? srcChainId),
      fromToken: srcTokenAddress,
      toToken: dstTokenAddress,
      fromAmount: amount,
      fromAddress,
      toAddress,
      slippage: String(env.LIFI_SLIPPAGE),
    });

    if (env.LIFI_INTEGRATOR) {
      params.set('integrator', env.LIFI_INTEGRATOR);
    }

    const headers: Record<string, string> = {};
    if (env.LIFI_API_KEY) {
      headers['x-lifi-api-key'] = env.LIFI_API_KEY;
    }

    const quoteRes = await fetch(`${env.LIFI_API_BASE_URL}/quote?${params.toString()}`, {
      method: 'GET',
      headers,
    });

    const text = await quoteRes.text();

    if (!quoteRes.ok) {
      return res.status(quoteRes.status).json({
        error: 'Deposit/withdraw quote failed. Please try a different amount or vault.',
      });
    }

    const raw = JSON.parse(text);

    const estimate = raw.estimate ?? {};
    const feeCosts = [...(estimate.feeCosts ?? []), ...(estimate.gasCosts ?? [])];
    const feeUsd = feeCosts.reduce((acc: number, c: { amountUSD?: string }) => {
      const n = Number(c.amountUSD ?? 0);
      return acc + (Number.isFinite(n) ? n : 0);
    }, 0);

    return res.json({
      transactionRequest: raw.transactionRequest ?? {},
      feeUsd,
      etaSeconds: Number(estimate.executionDuration ?? 60),
      destinationAmount: estimate.toAmount ?? '0',
    });
  } catch {
    return res.status(502).json({ error: 'Earn quote request failed.' });
  }
});

export default router;
