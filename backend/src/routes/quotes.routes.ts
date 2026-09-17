import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { requestLiFiQuote } from '../lib/lifiClient.js';
import { requestDebridgeQuote } from '../lib/debridgeClient.js';
import { requestSquidQuote } from '../lib/squidClient.js';
import { requestRelayQuote } from '../lib/relayClient.js';
import { env } from '../config/env.js';

const router = Router();

// 30 requests / minute per IP — only enforced outside development
const quoteLimiter = rateLimit({
  windowMs: 60_000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => env.NODE_ENV === 'development',
  message: { error: 'Too many quote requests. Please wait a moment before trying again.' }
});

router.post('/quotes', quoteLimiter, async (req, res) => {
  const requestedProvider = typeof req.query.provider === 'string' ? req.query.provider.toLowerCase() : undefined;
  const supportedProviders = ['lifi', 'debridge', 'squid', 'relay'] as const;

  if (requestedProvider && !supportedProviders.includes(requestedProvider as (typeof supportedProviders)[number])) {
    return res.status(400).json({
      error: `Unsupported provider "${requestedProvider}". Use one of: ${supportedProviders.join(', ')}.`
    });
  }

  const provider = requestedProvider ?? 'lifi';

  const { srcChainKey, dstChainKey, srcTokenAddress, dstTokenAddress, amount } = req.body ?? {};
  if (!srcTokenAddress || !dstTokenAddress || !amount) {
    return res.status(400).json({ error: 'Missing required fields: srcTokenAddress, dstTokenAddress, amount.' });
  }
  if (typeof amount !== 'string' || !/^\d+$/.test(amount)) {
    return res.status(400).json({ error: 'Amount must be a numeric string in smallest token units.' });
  }

  try {
    let quote:
      | Awaited<ReturnType<typeof requestLiFiQuote>>
      | Awaited<ReturnType<typeof requestDebridgeQuote>>
      | Awaited<ReturnType<typeof requestSquidQuote>>
      | Awaited<ReturnType<typeof requestRelayQuote>>;

    if (provider === 'debridge') {
      quote = await requestDebridgeQuote(req.body);
    } else if (provider === 'squid') {
      quote = await requestSquidQuote(req.body);
    } else if (provider === 'relay') {
      quote = await requestRelayQuote(req.body);
    } else {
      quote = await requestLiFiQuote(req.body);
    }

    return res.json(quote);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[quotes] ${provider} error:`, msg);
    const isClient = error instanceof Error && /missing|invalid|unsupported/i.test(msg);
    return res.status(isClient ? 400 : 502).json({
      error: isClient ? msg : `Quote request to ${provider} failed. Please try again.`,
      detail: process.env.NODE_ENV === 'development' ? msg : undefined
    });
  }
});

export default router;
