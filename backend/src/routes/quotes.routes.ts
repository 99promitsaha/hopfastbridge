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
import { requestRelayQuote, relayExecutionQuote } from '../lib/relayClient.js';
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
  const request = provider === 'relay' ? requestRelayQuote(payload) : provider === 'squid'
    ? requestSquidQuote(payload)
    : requestLiFiQuote(payload);
  inFlightQuotes.set(key, request);
  try {
    return await request;
  } finally {
    inFlightQuotes.delete(key);
  }
}
const chain = z.enum(['ethereum', 'base', 'bsc', 'polygon', 'monad', 'robinhood', 'arc']);
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
    .array(z.enum(['lifi', 'squid', 'relay']))
    .min(1)
    .max(3)
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
// Recheck a server-validated, short-lived quote immediately before approval/signing.
router.post('/quotes/relay/validate', quoteLimiter, (req, res) => {
  const parsed = comparisonSchema.safeParse(req.body);
  if (!parsed.success || typeof req.body.requestId !== 'string') return res.status(400).json({ error: 'Invalid Relay execution request.' });
  try {
    return res.json(relayExecutionQuote(req.body.requestId, parsed.data));
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : 'Relay quote expired. Refresh quotes.' });
  }
});

router.post('/quotes', quoteLimiter, async (req, res) => {
  const requestedProvider =
    typeof req.query.provider === 'string'
      ? req.query.provider.toLowerCase()
      : undefined;
  const supportedProviders = providers;

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

  const parsed = comparisonSchema.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json({
        error: 'Invalid quote request. Connect a wallet and select supported chains, tokens and a positive base-unit amount.',
      });
  }

  try {
    // Only pass schema-validated route fields. Provider options stay bounded by
    // their own clients; Relay fees/recipients can never be overridden by a caller.
    const quote = await requestProvider(provider as Provider, { ...parsed.data, options: req.body.options });

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
