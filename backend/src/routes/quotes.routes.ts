import { z } from 'zod';
import {
  providers,
  compareRoutes,
  type Provider,
  type QuoteResponse,
} from '../lib/routeComparison.js';
import { validAddress } from '../lib/arc.js';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { requestLiFiQuote } from '../lib/lifiClient.js';
import { requestSquidQuote } from '../lib/squidClient.js';
import { env } from '../config/env.js';

const router = Router();

// 30 requests / minute per IP — only enforced outside development
const quoteLimiter = rateLimit({
  windowMs: 60_000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => env.NODE_ENV === 'development',
  message: {
    error: 'Too many quote requests. Please wait a moment before trying again.',
  },
});

type Payload = Parameters<typeof requestLiFiQuote>[0];
const inFlightQuotes = new Map<string, Promise<QuoteResponse>>();
export async function requestProvider(
  provider: Provider,
  payload: Payload
): Promise<QuoteResponse> {
  const key = `${provider}:${JSON.stringify(payload)}`;
  const existing = inFlightQuotes.get(key);
  if (existing) return existing;
  const request = provider === 'squid'
    ? requestSquidQuote(payload)
    : requestLiFiQuote(payload);
  inFlightQuotes.set(key, request);
  try {
    return await request;
  } finally {
    inFlightQuotes.delete(key);
  }
}
const chain = z.enum(['ethereum', 'base', 'bsc', 'polygon', 'monad', 'arc']);
const comparisonSchema = z.object({
  srcChainKey: chain,
  dstChainKey: chain,
  srcTokenAddress: z.string().regex(/^0x[\da-fA-F]{40}$/),
  dstTokenAddress: z.string().regex(/^0x[\da-fA-F]{40}$/),
  srcWalletAddress: z.string().refine(validAddress),
  dstWalletAddress: z.string().refine(validAddress).optional(),
  amount: z
    .string()
    .regex(/^\d+$/)
    .max(78)
    .refine((value) => BigInt(value) > 0n && BigInt(value) < 2n ** 256n),
  providers: z
    .array(z.enum(['lifi', 'squid']))
    .min(1)
    .max(2)
    .optional(),
  maxFeeUsd: z.number().finite().nonnegative().optional(),
  maxEtaSeconds: z.number().finite().positive().optional(),
  minDestinationAmount: z.string().regex(/^\d+$/).max(78).optional(),
});
router.post('/quotes/compare', quoteLimiter, async (req, res) => {
  const parsed = comparisonSchema.safeParse(req.body);
  if (!parsed.success)
    return res
      .status(400)
      .json({
        error:
          'Invalid comparison request. Include a nonzero payer, supported chains, and positive base-unit amount.',
      });
  const input = parsed.data;
  const payload = {
    ...input,
    dstWalletAddress: input.dstWalletAddress ?? input.srcWalletAddress,
  };
  const requested = [...new Set(input.providers ?? providers)];
  const result = await compareRoutes(
    (provider) => requestProvider(provider, payload),
    requested,
    input
  );
  return res.json({
    ...result,
    observedAt: new Date().toISOString(),
    warning: 'Estimates can change before signing.',
  });
});

router.post('/quotes', quoteLimiter, async (req, res) => {
  const requestedProvider =
    typeof req.query.provider === 'string'
      ? req.query.provider.toLowerCase()
      : undefined;
  const supportedProviders = ['lifi', 'squid'] as const;

  if (
    requestedProvider &&
    !supportedProviders.includes(
      requestedProvider as (typeof supportedProviders)[number]
    )
  ) {
    return res.status(400).json({
      error: `Unsupported provider "${requestedProvider}". Use one of: ${supportedProviders.join(', ')}.`,
    });
  }

  const provider = requestedProvider ?? 'lifi';

  const { srcChainKey, dstChainKey, srcTokenAddress, dstTokenAddress, amount } =
    req.body ?? {};
  if (!srcTokenAddress || !dstTokenAddress || !amount) {
    return res
      .status(400)
      .json({
        error:
          'Missing required fields: srcTokenAddress, dstTokenAddress, amount.',
      });
  }
  if (typeof amount !== 'string' || !/^\d+$/.test(amount)) {
    return res
      .status(400)
      .json({
        error: 'Amount must be a numeric string in smallest token units.',
      });
  }

  try {
    const quote = await requestProvider(provider as Provider, req.body);

    return res.json(quote);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[quotes] ${provider} error:`, msg);
    const isClient =
      error instanceof Error && /missing|invalid|unsupported/i.test(msg);
    return res.status(isClient ? 400 : 502).json({
      error: isClient
        ? msg
        : `Quote request to ${provider} failed. Please try again.`,
      detail: process.env.NODE_ENV === 'development' ? msg : undefined,
    });
  }
});

export default router;
