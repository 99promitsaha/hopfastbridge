import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import { env } from './config/env.js';
import { connectDatabase } from './config/db.js';
import { startPaymentTracking } from './lib/paymentStore.js';
import routes from './routes/index.js';

const app = express();

// Railway terminates TLS and forwards the original client IP through one proxy.
// Trusting exactly that hop keeps secure cookies and rate limiting correct in production.
if (env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

app.use(
  cors({
    origin: env.CORS_ORIGIN,
    credentials: true
  })
);
app.use(helmet());
app.use(compression({ threshold: 1024 }));
app.use(morgan('dev', {skip: req => req.path.startsWith('/api/architects')}));
app.use(rateLimit({
  windowMs: 60_000,
  limit: 180,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path === '/api/health',
  message: { error: 'Too many requests. Please wait a moment and try again.' },
}));
app.use(express.json({ limit: '64kb' }));

app.use('/api', routes);

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (env.NODE_ENV !== 'production') {
    console.error(error);
  }

  res.status(500).json({
    error: 'Internal server error'
  });
});

async function bootstrap() {
  await connectDatabase();

  startPaymentTracking();
  app.listen(env.PORT, () => {
    console.log(`[api] HopFast backend listening on port ${env.PORT}`);
  });
}

bootstrap().catch((error) => {
  console.error('[api] Failed to start backend', error);
  process.exit(1);
});
