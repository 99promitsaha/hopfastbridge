import { Router } from 'express';
import { TransactionHistory } from '../models/TransactionHistory.js';
import { isDatabaseReady } from '../config/db.js';
const router = Router();
router.get('/stats', async (req, res) => {
  const period = ['all', '7d', '15d', '30d'].includes(String(req.query.period)) ? String(req.query.period) : '7d';
  if (!isDatabaseReady()) return res.json({ period, uniqueUsers: 0, swapVolumeUsd: 0, swapCount: 0, protocolFeeUsd: 0 });
  const days = period === 'all' ? null : Number(period.slice(0, -1));
  const filter = days == null ? {} : { createdAt: { $gte: new Date(Date.now() - days * 86400000) } };
  try {
  const [stats, users] = await Promise.all([
    TransactionHistory.aggregate([{ $match: filter }, { $group: { _id: null, total: { $sum: { $ifNull: ['$volumeUsd', 0] } }, count: { $sum: 1 } } }]),
    TransactionHistory.distinct('userAddress', filter)
  ]);
  return res.json({ period, uniqueUsers: users.length, swapVolumeUsd: Math.round((stats[0]?.total ?? 0) * 100) / 100, swapCount: stats[0]?.count ?? 0, protocolFeeUsd: 0 });
  } catch { return res.status(503).json({ error: 'Swap statistics are temporarily unavailable.' }); }
});
export default router;
