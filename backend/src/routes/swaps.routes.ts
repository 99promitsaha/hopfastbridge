import { Router } from 'express';
import { z } from 'zod';
import { SwapRecord } from '../models/SwapRecord.js';
import { TransactionHistory } from '../models/TransactionHistory.js';
import { isDatabaseReady } from '../config/db.js';

const router = Router();
const TX_HASH_REGEX = /^0x[a-fA-F0-9]{64}$/;

const createSwapSchema = z.object({
  userAddress: z.string().min(8),
  quoteId: z.string().min(2),
  provider: z.string().min(2).optional(),
  fromChain: z.string().min(2),
  toChain: z.string().min(2),
  fromTokenSymbol: z.string().min(2),
  toTokenSymbol: z.string().min(2),
  amount: z.string().min(1),
  volumeUsd: z.number().nonnegative().optional(),
  txHash: z.string().regex(TX_HASH_REGEX).optional(),
  status: z.string().optional(),
  metadata: z.unknown().optional()
});

function metadataFieldAsString(metadata: unknown, key: string): string | undefined {
  if (!metadata || typeof metadata !== 'object') return undefined;
  const value = (metadata as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : undefined;
}

router.post('/swaps', async (req, res) => {
  if (!isDatabaseReady()) {
    return res.status(503).json({ error: 'Database unavailable. Add MONGODB_URI and retry.' });
  }

  const parsed = createSwapSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid swap payload.' });
  }

  const payload = parsed.data;
  const normalizedUserAddress = payload.userAddress.toLowerCase();
  const metadataTxHash = metadataFieldAsString(payload.metadata, 'txHash');
  const metadataProvider = metadataFieldAsString(payload.metadata, 'provider');
  const txHashCandidate = payload.txHash ?? metadataTxHash;
  const normalizedTxHash =
    typeof txHashCandidate === 'string' && TX_HASH_REGEX.test(txHashCandidate)
      ? txHashCandidate.toLowerCase()
      : undefined;
  const provider = payload.provider ?? metadataProvider;

  const created = await SwapRecord.create({
    ...payload,
    userAddress: normalizedUserAddress,
    txHash: normalizedTxHash,
    provider
  });

  if (normalizedTxHash) {
    await TransactionHistory.findOneAndUpdate(
      { userAddress: normalizedUserAddress, txHash: normalizedTxHash },
      {
        $set: {
          quoteId: payload.quoteId,
          provider,
          fromChain: payload.fromChain,
          toChain: payload.toChain,
          fromTokenSymbol: payload.fromTokenSymbol,
          toTokenSymbol: payload.toTokenSymbol,
          amount: payload.amount,
          ...(payload.volumeUsd != null && { volumeUsd: payload.volumeUsd }),
          status: payload.status ?? 'submitted',
          metadata: payload.metadata
        }
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  }

  return res.status(201).json(created);
});

router.get('/swaps', async (req, res) => {
  if (!isDatabaseReady()) {
    return res.status(503).json({ error: 'Database unavailable. Add MONGODB_URI and retry.' });
  }

  const limit = Math.min(Number(req.query.limit ?? 25), 100);
  const userAddress = typeof req.query.userAddress === 'string' ? req.query.userAddress.toLowerCase() : undefined;
  const query = userAddress ? { userAddress } : {};
  const records = await SwapRecord.find(query).sort({ createdAt: -1 }).limit(limit);

  return res.json({
    count: records.length,
    records
  });
});

export default router;
