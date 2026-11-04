import { mkdirSync } from 'node:fs';
import { env } from './config';
import { logger } from './logger';
import { connectDb } from './db';
import { createApp } from './app';
import { ensureBaseline } from './bootstrap';
import { processOutbox } from './core/outbox/service';

/** Local development server. Deployed stages use the Lambda handlers instead. */
async function main() {
  let uri = env().MONGODB_URI;
  if (!uri && env().DEV_AUTO_MONGO) {
    // Zero-setup local database: an in-process MongoDB replica set persisted under .data/mongo (transactions supported).
    const { MongoMemoryReplSet } = await import('mongodb-memory-server');
    mkdirSync('.data/mongo', { recursive: true });
    const repl = await MongoMemoryReplSet.create({
      replSet: { count: 1, storageEngine: 'wiredTiger', dbName: 'eayni' },
      instanceOpts: [{ dbPath: '.data/mongo', storageEngine: 'wiredTiger' }],
    });
    uri = repl.getUri('eayni');
    logger.info({ uri }, 'local MongoDB started (data persisted in .data/mongo)');
  }
  await connectDb(uri);
  await ensureBaseline();
  const app = createApp();
  app.listen(env().PORT, () => logger.info(`API listening on http://localhost:${env().PORT}`));
  // Outbox worker loop (a scheduled Lambda in deployed stages).
  setInterval(() => processOutbox().catch((err) => logger.error({ err }, 'outbox tick failed')), 2_000).unref();
}

main().catch((err) => {
  logger.error({ err }, 'failed to start');
  process.exit(1);
});
