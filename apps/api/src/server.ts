import { env } from './config';
import { logger } from './logger';
import { connectDb, disconnectDb } from './db';
import { createApp } from './app';
import { ensureBaseline } from './bootstrap';
import { processOutbox } from './core/outbox/service';
import { startDevMongo } from './devMongo';

/** Local development server. Deployed stages use the Lambda handlers instead. */
async function main() {
  let uri = env().MONGODB_URI;
  let stopMongo = async () => {};
  if (!uri && env().DEV_AUTO_MONGO) ({ uri, stop: stopMongo } = await startDevMongo());
  await connectDb(uri);
  await ensureBaseline();
  const app = createApp();
  app.listen(env().PORT, () => logger.info(`API listening on http://localhost:${env().PORT}`));
  // Outbox worker loop (a scheduled Lambda in deployed stages).
  setInterval(
    () => processOutbox().catch((err) => logger.error({ err }, 'outbox tick failed')),
    2_000,
  ).unref();

  // Graceful shutdown: stop the in-process MongoDB so no orphan mongod keeps the port.
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'shutting down');
    await disconnectDb().catch(() => {});
    await stopMongo().catch(() => {});
    process.exit(0);
  };
  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  logger.error({ err }, 'failed to start');
  process.exit(1);
});
