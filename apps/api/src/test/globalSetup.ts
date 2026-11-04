import { MongoMemoryReplSet } from 'mongodb-memory-server';

/** One in-memory replica set for the whole run (transactions supported). */
export default async function setup() {
  const repl = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  process.env.MONGODB_URI_TEST = repl.getUri();
  return async () => {
    await repl.stop();
  };
}
