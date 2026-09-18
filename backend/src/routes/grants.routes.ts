import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { MicroGrant } from '../models/MicroGrant.js';
import { isDatabaseReady } from '../config/db.js';
export const grantSchema = z.object({
  title: z.string().trim().min(3).max(80),
  handle: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_]{1,15}$/),
  projectUrl: z
    .string()
    .trim()
    .url()
    .max(500)
    .refine((value) => {
      try {
        return new URL(value).protocol === 'https:';
      } catch {
        return false;
      }
    }),
  description: z.string().trim().min(30).max(1200),
  milestone: z.string().trim().min(15).max(600),
  targetUsdc: z
    .string()
    .max(20)
    .regex(/^\d+(\.\d{1,6})?$/)
    .refine((value) => Number(value) > 0 && Number(value) <= 1_000_000),
});
const router = Router();
const limiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many requests. Please wait before posting another micro-grant.',
  },
});
router.get('/grants', async (_req, res, next) => {
  if (!isDatabaseReady())
    return res
      .status(503)
      .json({ error: 'The request board is temporarily unavailable.' });
  try {
    res.json({
      requests: await MicroGrant.find()
        .sort({ createdAt: -1 })
        .limit(100)
        .lean(),
    });
  } catch (error) {
    next(error);
  }
});
router.post('/grants', limiter, async (req, res, next) => {
  const parsed = grantSchema.safeParse(req.body);
  if (!parsed.success)
    return res.status(400).json({
      error:
        'Include a valid X handle, HTTPS project link, project description, milestone, and positive USDC target.',
      fields: parsed.error.flatten().fieldErrors,
    });
  if (!isDatabaseReady())
    return res
      .status(503)
      .json({ error: 'The request board is temporarily unavailable.' });
  try {
    const request = await MicroGrant.create(parsed.data);
    return res.status(201).json({ request });
  } catch (error) {
    next(error);
  }
});
export default router;
