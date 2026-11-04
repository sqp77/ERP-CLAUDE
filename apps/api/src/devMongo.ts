import { mkdirSync } from 'node:fs';
import { MongoClient } from 'mongodb';
import { logger } from './logger';

const PORT = 27117;
const REPL = 'eayni-dev';
const DB_PATH = '.data/mongo';
export const DEV_MONGO_URI = `mongodb://127.0.0.1:${PORT}/eayni?replicaSet=${REPL}`;

/** True only when a healthy MongoDB answers on the dev port (a mongod that is shutting down does not count). */
async function mongoAlive(): Promise<boolean> {
  const client = new MongoClient(`mongodb://127.0.0.1:${PORT}/?directConnection=true`, {
    serverSelectionTimeoutMS: 1500,
    connectTimeoutMS: 1500,
  });
  try {
    await client.connect();
    await client.db('admin').command({ ping: 1 });
    return true;
  } catch {
    return false;
  } finally {
    await client.close().catch(() => {});
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Zero-setup local database (development only): an in-process MongoDB single-node replica set on a
 * fixed port, persisted under .data/mongo so data survives restarts and transactions work.
 * If a healthy instance already listens on the port (e.g. the dev server while running the seed), reuse it.
 */
export async function startDevMongo(): Promise<{ uri: string; stop: () => Promise<void> }> {
  if (await mongoAlive()) {
    logger.info({ uri: DEV_MONGO_URI }, 'reusing running local MongoDB');
    return { uri: DEV_MONGO_URI, stop: async () => {} };
  }
  const { MongoMemoryReplSet } = await import('mongodb-memory-server');
  mkdirSync(DB_PATH, { recursive: true });
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 6; attempt++) {
    try {
      const repl = await MongoMemoryReplSet.create({
        replSet: { name: REPL, count: 1, storageEngine: 'wiredTiger', dbName: 'eayni' },
        instanceOpts: [{ port: PORT, dbPath: DB_PATH, storageEngine: 'wiredTiger' }],
      });
      logger.info({ uri: DEV_MONGO_URI, dbPath: DB_PATH }, 'local MongoDB started');
      return {
        uri: DEV_MONGO_URI,
        stop: async () => {
          await repl.stop();
        },
      };
    } catch (err) {
      lastErr = err;
      logger.warn(
        { attempt, err: err instanceof Error ? err.message : String(err) },
        'local MongoDB not ready yet, retrying',
      );
      await sleep(1500);
    }
  }
  throw lastErr;
}
