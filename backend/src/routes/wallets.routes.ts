import { Router } from 'express';
import { z } from 'zod';
import { Wallet } from '../models/Wallet.js';
import { isDatabaseReady } from '../config/db.js';

const router = Router();

const walletSchema = z.object({
  address: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid wallet address')
});

router.post('/wallets', async (req, res) => {
  if (!isDatabaseReady()) {
    return res.status(503).json({ error: 'Database unavailable.' });
  }

  const parsed = walletSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid wallet address.' });
  }

  const wallet = await Wallet.findOneAndUpdate(
    { address: parsed.data.address.toLowerCase() },
    { lastSeenAt: new Date() },
    { upsert: true, new: true }
  );

  return res.status(200).json(wallet);
});

export default router;
