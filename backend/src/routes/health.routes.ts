import { Router } from 'express';
import { isDatabaseReady } from '../config/db.js';

const router = Router();

router.get('/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'hopfast-api',
    db: isDatabaseReady() ? 'connected' : 'disconnected'
  });
});

export default router;
