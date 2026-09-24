import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const emptyToUndefined = (value: unknown) =>
  typeof value === 'string' && value.trim().length === 0 ? undefined : value;

const schema = z.object({
  ARCHITECT_ESCROW_ADDRESS: z.preprocess(emptyToUndefined, z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional()),
  ARCHITECT_CHAIN_ID: z.coerce.number().default(5042),
  ARCHITECT_SIGNER_KEY: z.preprocess(emptyToUndefined, z.string().regex(/^0x[0-9a-fA-F]{64}$/).optional()),
  ARCHITECT_ADMIN_ADDRESS: z.preprocess(emptyToUndefined, z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional()),
  ARCHITECT_TREASURY_ADDRESS: z.preprocess(emptyToUndefined, z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional()),
  X_BEARER_TOKEN: z.preprocess(emptyToUndefined, z.string().optional()),
  X_CLIENT_ID: z.preprocess(emptyToUndefined, z.string().optional()),
  X_CLIENT_SECRET: z.preprocess(emptyToUndefined, z.string().optional()),
  X_CALLBACK_URL: z.string().url().default('http://127.0.0.1:8080/api/architects/x/callback'),
  ARC_RPC_URL: z.string().url().default('https://rpc.mainnet.arc.io'),
  APP_BASE_URL: z.string().url().default('http://localhost:5173'),
  PAYMENT_STORE_PATH: z.string().default('./data/payments.json'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(8080),
  CORS_ORIGIN: z.string().default('http://localhost:5173').transform((val) => val.split(',').map(s => s.trim())),
  MONGODB_URI: z.preprocess(emptyToUndefined, z.string().optional()),
  LIFI_API_KEY: z.preprocess(emptyToUndefined, z.string().optional()),
  LIFI_API_BASE_URL: z.string().default('https://li.quest/v1'),
  LIFI_INTEGRATOR: z.preprocess(emptyToUndefined, z.string().optional()),
  LIFI_FEE: z.preprocess(emptyToUndefined, z.coerce.number().min(0).lt(1).optional()),
  LIFI_SLIPPAGE: z.coerce.number().default(0.005),
  SQUID_API_BASE_URL: z.string().default('https://v2.api.squidrouter.com'),
  SQUID_INTEGRATOR_ID: z.preprocess(emptyToUndefined, z.string().optional()),
  COINGECKO_API_KEY: z.preprocess(emptyToUndefined, z.string().optional()),
  CMC_API_KEY: z.preprocess(emptyToUndefined, z.string().optional())
});

export const env = schema.parse(process.env);
