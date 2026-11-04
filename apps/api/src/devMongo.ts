import { mkdirSync } from 'node:fs';
import { MongoClient } from 'mongodb';
import { logger } from './logger';

const PORT = 27117;
const REPL = 'eayni-dev';
const DB_PATH = '.data/mongo';
const HOST = `127.0.0.1:${PORT}`;
export const DEV_MONGO_URI = `mongodb://${HOST}/eayni?replicaSet=${REPL}`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function directClient() {
  return new MongoClient(`mongodb://${HOST}/?directConnection=true`, {
    serverSelectionTimeoutMS: 1500,
    connectTimeoutMS: 1500,
  });
}

/** True only when a healthy MongoDB answers on the dev port (a mongod that is shutting down does not count). */
async function mongoAlive(): Promise<boolean> {
  const client = directClient();
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

/**
 * Initiate the single-node replica set on first start, or just wait until the persisted one is primary.
 * We do this ourselves (instead of MongoMemoryReplSet) because the library re-runs replSetReconfig on every
 * start, which fails against a persisted data directory.
 */
async function ensureReplicaSet(): Promise<void> {
  const client = directClient();
  await client.connect();
  try {
    const admin = client.db('admin');
    for (let i = 0; i < 60; i++) {
      try {
        const status = (await admin.command({ replSetGetStatus: 1 })) as { myState?: number };
        if (status.myState === 1) return; // PRIMARY
      } catch (err) {
        const e = err as { code?: number; codeName?: string };
        if (e.code === 94 || e.codeName === 'NotYetInitialized') {
          await admin.command({ replSetInitiate: { _id: REPL, members: [{ _id: 0, host: HOST }] } });
        } else if (e.code !== 93 && e.codeName !== 'InvalidReplicaSetConfig') {
          throw err;
        }
      }
      await sleep(500);
    }
    throw new Error('local MongoDB did not become primary in time');
  } finally {
    await client.close().catch(() => {});
  }
}

/**
 * Zero-setup local database (development only): an in-process MongoDB started as a single-node replica
 * set on a fixed port, persisted under .data/mongo so data survives restarts and transactions work.
 * If a healthy instance already listens on the port (e.g. the dev server while running the seed), reuse it.
 */
export async function startDevMongo(): Promise<{ uri: string; stop: () => Promise<void> }> {
  if (await mongoAlive()) {
    logger.info({ uri: DEV_MONGO_URI }, 'reusing running local MongoDB');
    return { uri: DEV_MONGO_URI, stop: async () => {} };
  }
  const { MongoMemoryServer } = await import('mongodb-memory-server');
  mkdirSync(DB_PATH, { recursive: true });
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 6; attempt++) {
    let server: InstanceType<typeof MongoMemoryServer> | undefined;
    try {
      server = await MongoMemoryServer.create({
        instance: { port: PORT, dbPath: DB_PATH, storageEngine: 'wiredTiger', replSet: REPL },
      });
      await ensureReplicaSet();
      logger.info({ uri: DEV_MONGO_URI, dbPath: DB_PATH }, 'local MongoDB started');
      const s = server;
      return {
        uri: DEV_MONGO_URI,
        stop: async () => {
          await s.stop({ doCleanup: false });
        },
      };
    } catch (err) {
      lastErr = err;
      await server?.stop({ doCleanup: false }).catch(() => {});
      logger.warn(
        { attempt, err: err instanceof Error ? err.message : String(err) },
        'local MongoDB not ready yet, retrying',
      );
      await sleep(1500);
    }
  }
  throw lastErr;
}
