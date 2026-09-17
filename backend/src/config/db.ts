import mongoose from 'mongoose';
import { env } from './env.js';

export async function connectDatabase(): Promise<void> {
  if (!env.MONGODB_URI) {
    console.warn('[db] MONGODB_URI missing. Running without persistence.');
    return;
  }

  try {
    await mongoose.connect(env.MONGODB_URI);
    console.log('[db] MongoDB connected');
  } catch (error) {
    console.warn('[db] Failed to connect to MongoDB. Continuing without persistence.');
    if (env.NODE_ENV !== 'production') {
      console.warn(error);
    }
  }
}

export function isDatabaseReady(): boolean {
  return mongoose.connection.readyState === 1;
}
