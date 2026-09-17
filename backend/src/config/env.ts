import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const emptyToUndefined = (value: unknown) =>
  typeof value === 'string' && value.trim().length === 0 ? undefined : value;

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(8080),
  CORS_ORIGIN: z.string().default('http://localhost:5173').transform((val) => val.split(',').map(s => s.trim())),
  MONGODB_URI: z.preprocess(emptyToUndefined, z.string().optional()),
  LIFI_API_KEY: z.preprocess(emptyToUndefined, z.string().optional()),
  LIFI_API_BASE_URL: z.string().default('https://li.quest/v1'),
  LIFI_INTEGRATOR: z.preprocess(emptyToUndefined, z.string().optional()),
  LIFI_FEE: z.preprocess(emptyToUndefined, z.coerce.number().optional()),
  LIFI_SLIPPAGE: z.coerce.number().default(0.005),
  DEBRIDGE_API_BASE_URL: z.string().default('https://dln.debridge.finance'),
  DEBRIDGE_ACCESS_TOKEN: z.preprocess(emptyToUndefined, z.string().optional()),
  DEBRIDGE_REFERRAL_CODE: z.preprocess(emptyToUndefined, z.coerce.number().optional()),
  SQUID_API_BASE_URL: z.string().default('https://v2.api.squidrouter.com'),
  SQUID_INTEGRATOR_ID: z.preprocess(emptyToUndefined, z.string().optional()),
  RELAY_API_BASE_URL: z.string().default('https://api.relay.link'),
  RELAY_APP_FEES_RECIPIENT: z.preprocess(emptyToUndefined, z.string().optional()),
  COINGECKO_API_KEY: z.preprocess(emptyToUndefined, z.string().optional()),
  CMC_API_KEY: z.preprocess(emptyToUndefined, z.string().optional())
});

export const env = schema.parse(process.env);
