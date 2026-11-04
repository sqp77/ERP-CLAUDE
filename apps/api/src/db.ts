import mongoose from 'mongoose';
import { env } from './config';
import { logger } from './logger';

/**
 * One cached connection per process (CLAUDE.md "Serverless rules": connect once outside the handler,
 * cache the promise, small pool).
 */
let connecting: Promise<typeof mongoose> | undefined;

export async function connectDb(uri = env().MONGODB_URI): Promise<typeof mongoose> {
  if (mongoose.connection.readyState === 1) return mongoose;
  if (!connecting) {
    if (!uri) throw new Error('MONGODB_URI is not set');
    mongoose.set('strictQuery', true);
    connecting = mongoose
      .connect(uri, { maxPoolSize: 5, serverSelectionTimeoutMS: 10_000 })
      .then((m) => {
        logger.info({ host: m.connection.host, db: m.connection.name }, 'mongo connected');
        return m;
      })
      .catch((err) => {
        connecting = undefined;
        throw err;
      });
  }
  return connecting;
}

export async function disconnectDb(): Promise<void> {
  connecting = undefined;
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
}

/** True when the server supports multi-document transactions (replica set / Atlas). */
export function supportsTransactions(): boolean {
  const topology = (mongoose.connection.getClient() as unknown as { topology?: { description?: { type?: string } } })
    .topology;
  const type = topology?.description?.type ?? '';
  return type.includes('ReplicaSet') || type === 'Sharded' || type === 'LoadBalanced';
}

/**
 * Run `fn` inside a transaction when the deployment supports it, otherwise plainly.
 * Used so the outbox write and the business write commit together (CLAUDE.md "Domain events").
 */
export async function withTransaction<T>(fn: (session: mongoose.ClientSession | undefined) => Promise<T>): Promise<T> {
  if (!supportsTransactions()) return fn(undefined);
  const session = await mongoose.startSession();
  try {
    let result!: T;
    await session.withTransaction(async () => {
      result = await fn(session);
    });
    return result;
  } finally {
    await session.endSession();
  }
}
