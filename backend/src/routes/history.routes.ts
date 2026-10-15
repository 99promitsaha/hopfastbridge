import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { isDatabaseReady } from '../config/db.js';
import { TransactionHistory } from '../models/TransactionHistory.js';
import { historyQuerySchema, historyProjection, publicHistoryRecord, safePublicRoute } from '../lib/publicResponses.js';
import { HistoryError, recordHistorySchema, recordVerifiedHistory } from '../lib/swapVerification.js';

const recordingLimit = rateLimit({ windowMs: 60000, limit: 30, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many history requests. Please retry shortly.' } });
export function historyRoutes(path: 'swaps' | 'transactions') {
  const router = Router();
  router.use('/' + path, (_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  router.post('/' + path, recordingLimit, safePublicRoute(async (req, res) => {
    if (!isDatabaseReady()) return res.status(503).json({ error: 'History is temporarily unavailable.' });
    const input = recordHistorySchema.safeParse(req.body);
    if (!input.success) return res.status(400).json({ error: 'A transaction hash and issued Hopfast quote proof are required.' });
    try { return res.status(201).json(publicHistoryRecord(await recordVerifiedHistory(input.data))); }
    catch (error) {
      if (error instanceof HistoryError) return res.status(error.status).json({ error: error.message });
      throw error;
    }
  }));
  router.get('/' + path, safePublicRoute(async (req, res) => {
    if (!isDatabaseReady()) return res.status(503).json({ error: 'History is temporarily unavailable.' });
    const input = historyQuerySchema.safeParse(req.query);
    if (!input.success) return res.status(400).json({ error: 'Provide a valid wallet address and a limit between 1 and 100.' });
    const records = await TransactionHistory.find({ userAddress: input.data.userAddress, proofVersion: 1 }).select(historyProjection).sort({ createdAt: -1 }).limit(input.data.limit);
    return res.json({ count: records.length, records: records.map(publicHistoryRecord) });
  }));
  return router;
}
