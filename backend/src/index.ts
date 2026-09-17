import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { env } from './config/env.js';
import { connectDatabase } from './config/db.js';
import routes from './routes/index.js';

const app = express();

app.use(
  cors({
    origin: env.CORS_ORIGIN,
    credentials: true
  })
);
app.use(helmet());
app.use(morgan('dev'));
app.use(express.json({ limit: '1mb' }));

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

  app.listen(env.PORT, () => {
    console.log(`[api] HopFast backend listening on port ${env.PORT}`);
  });
}

bootstrap().catch((error) => {
  console.error('[api] Failed to start backend', error);
  process.exit(1);
});
