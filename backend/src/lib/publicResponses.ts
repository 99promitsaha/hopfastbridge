import { z } from 'zod';
import type { Request, Response, NextFunction } from 'express';

export const safePublicRoute = (handler: (req: Request, res: Response) => Promise<unknown>) => async (req: Request, res: Response, _next: NextFunction) => {
  try { await handler(req, res); }
  catch { res.status(503).json({ error: 'This request is temporarily unavailable. Please retry.' }); }
};

export const walletAddressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/).transform(value => value.toLowerCase());
export const historyQuerySchema = z.object({
  userAddress: walletAddressSchema,
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export const trackingMetadataSchema = z.object({
  txHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/).optional(),
  provider: z.string().min(2).max(32).optional(),
  quoteId: z.string().max(256).optional(),
  requestId: z.string().max(256).optional(),
});
export const historyProjection = 'userAddress txHash quoteId provider fromChain toChain fromTokenSymbol toTokenSymbol amount status createdAt updatedAt metadata.txHash metadata.provider metadata.quoteId metadata.requestId';

/** Public chain activity, with no database internals or arbitrary stored metadata. */
export function publicHistoryRecord(record: any) {
  const metadata = trackingMetadataSchema.safeParse(record.metadata);
  return {
    userAddress: record.userAddress, txHash: record.txHash, quoteId: record.quoteId,
    provider: record.provider, fromChain: record.fromChain, toChain: record.toChain,
    fromTokenSymbol: record.fromTokenSymbol, toTokenSymbol: record.toTokenSymbol,
    amount: record.amount, status: record.status, createdAt: record.createdAt, updatedAt: record.updatedAt,
    metadata: metadata.success ? metadata.data : undefined,
  };
}

/** Keep execution/safety fields intact; upstream debug blobs are not an API contract. */
export function publicQuoteResponse<T>(value: T): T {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const { raw: _raw, ...rest } = value as Record<string, unknown>;
  if (Array.isArray(rest.quotes)) rest.quotes = rest.quotes.map(publicQuoteResponse);
  if (Array.isArray(rest.routes)) rest.routes = rest.routes.map(publicQuoteResponse);
  if (rest.quote) rest.quote = publicQuoteResponse(rest.quote);
  if (rest.best) rest.best = publicQuoteResponse(rest.best);
  return rest as T;
}
