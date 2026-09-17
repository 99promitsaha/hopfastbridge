import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { getTokenPrices } from '../lib/tokenPrices.js';
const router = Router();
router.get('/prices', rateLimit({ windowMs: 60000, limit: 60, standardHeaders: true, legacyHeaders: false }), async (_req, res) => {
  try {
    const prices = await getTokenPrices();
    if (!Object.keys(prices).length) return res.status(503).json({ error: 'Prices temporarily unavailable.' });
    res.setHeader('Cache-Control', 'public, max-age=15');
    return res.json({ prices });
  } catch { return res.status(503).json({ error: 'Prices temporarily unavailable.' }); }
});
export default router;
