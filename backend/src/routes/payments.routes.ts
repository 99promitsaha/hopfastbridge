import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { assertArcNetwork, arcRpc, formatUsdc, validAddress } from '../lib/arc.js';
import { createPayment, getPayment, publicPayment, refreshPayment, submitPayment, cancelPayment } from '../lib/paymentStore.js';
const router = Router();
const address = z.string().refine(validAddress);
const schema = z.object({ walletAddress: address, recipient: address, amount: z.string().max(50), memo: z.string().max(180).optional() }).strict();
router.use(['/payments', '/arc/balance'], rateLimit({ windowMs: 60000, limit: 30, standardHeaders: true, legacyHeaders: false }));
router.use('/payments', (_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
router.post('/payments', (req, res) => {
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid payment details.' });
  try { return res.status(201).json(createPayment(parsed.data)); }
  catch (error) { return res.status(400).json({ error: error instanceof Error ? error.message : 'Invalid payment.' }); }
});
router.get('/arc/balance/:address', async (req, res) => {
  if (!validAddress(req.params.address)) return res.status(400).json({ error: 'Invalid address.' });
  try {
    await assertArcNetwork();
    const raw = await arcRpc<string>('eth_getBalance', [req.params.address, 'latest']);
    return res.json({ chainId: 5042, asset: 'USDC', decimals: 18, balanceRaw: BigInt(raw).toString(), balance: formatUsdc(BigInt(raw)), source: 'native', observedAt: new Date().toISOString() });
  } catch { return res.status(502).json({ error: 'Could not verify Arc balance.' }); }
});
router.use('/payments/:id', (req, res, next) => {
  const token = req.headers.authorization?.match(/^Bearer ([\da-f]{64})$/)?.[1] ?? '';
  const payment = getPayment(req.params.id, token);
  if (!payment) return res.status(404).json({ error: 'Payment not found or access token invalid.' });
  res.locals.payment = payment; next();
});
router.get('/payments/:id', async (_req, res) => res.json(publicPayment(await refreshPayment(res.locals.payment))));
router.post('/payments/:id/submit', async (req, res) => {
  try { return res.json(publicPayment(await submitPayment(res.locals.payment, String(req.body?.txHash ?? '')))); }
  catch (error) { return res.status(409).json({ error: error instanceof Error ? error.message : 'Could not record payment.' }); }
});
router.post('/payments/:id/cancel', (_req, res) => {
  try { cancelPayment(res.locals.payment); return res.json(publicPayment(res.locals.payment)); }
  catch { return res.status(409).json({ error: 'Payment cannot be cancelled.' }); }
});
export default router;
