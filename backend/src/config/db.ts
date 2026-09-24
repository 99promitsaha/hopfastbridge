import mongoose from 'mongoose';
import { env } from './env.js';

export async function connectDatabase(): Promise<void> {
  if (!env.MONGODB_URI) {
    if (env.NODE_ENV === 'production') {
      throw new Error('MONGODB_URI is required in production.');
    }
    console.warn('[db] MONGODB_URI missing. Running without persistence.');
    return;
  }

  try {
    await mongoose.connect(env.MONGODB_URI, {
      serverSelectionTimeoutMS: 10_000,
      connectTimeoutMS: 10_000,
    });
    console.log('[db] MongoDB connected');
  } catch (error) {
    if (env.NODE_ENV === 'production') throw error;
    console.warn('[db] Failed to connect to MongoDB. Continuing without persistence.');
    console.warn(error);
  }
}

export function isDatabaseReady(): boolean {
  return mongoose.connection.readyState === 1;
}
