import { Router } from 'express';
import { z } from 'zod';
import { isDatabaseReady } from '../config/db.js';
import { TransactionHistory } from '../models/TransactionHistory.js';

const router = Router();

const TX_HASH_REGEX = /^0x[a-fA-F0-9]{64}$/;
const WALLET_REGEX = /^0x[a-fA-F0-9]{40}$/;

const createTransactionSchema = z.object({
  userAddress: z.string().regex(WALLET_REGEX),
  txHash: z.string().regex(TX_HASH_REGEX),
  quoteId: z.string().min(2).optional(),
  provider: z.string().min(2).optional(),
  fromChain: z.string().min(2),
  toChain: z.string().min(2),
  fromTokenSymbol: z.string().min(2),
  toTokenSymbol: z.string().min(2),
  amount: z.string().min(1),
  status: z.string().optional(),
  metadata: z.unknown().optional()
});

router.post('/transactions', async (req, res) => {
  if (!isDatabaseReady()) {
    return res.status(503).json({ error: 'Database unavailable. Add MONGODB_URI and retry.' });
  }

  const parsed = createTransactionSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid transaction payload.' });
  }

  const payload = parsed.data;

  const saved = await TransactionHistory.findOneAndUpdate(
    { userAddress: payload.userAddress.toLowerCase(), txHash: payload.txHash.toLowerCase() },
    {
      $set: {
        ...payload,
        userAddress: payload.userAddress.toLowerCase(),
        txHash: payload.txHash.toLowerCase(),
        status: payload.status ?? 'submitted'
      }
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  return res.status(201).json(saved);
});

router.get('/transactions', async (req, res) => {
  if (!isDatabaseReady()) {
    return res.status(503).json({ error: 'Database unavailable. Add MONGODB_URI and retry.' });
  }

  const limit = Math.min(Number(req.query.limit ?? 25), 100);
  const userAddress = typeof req.query.userAddress === 'string' ? req.query.userAddress.toLowerCase() : undefined;
  const query = userAddress ? { userAddress } : {};

  const records = await TransactionHistory.find(query).sort({ createdAt: -1 }).limit(limit);

  return res.json({
    count: records.length,
    records
  });
});

export default router;
