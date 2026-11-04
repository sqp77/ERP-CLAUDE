import { afterAll, beforeAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { connectDb, disconnectDb } from '../db';
import { ensureBaseline } from '../bootstrap';
import { clearSettingsCache } from '../core/settings/service';
import { clearRoleCache } from '../core/rbac/service';
import { clearWorkflowCache } from '../core/workflow/engine';
import { clearSubscribers } from '../core/outbox/service';

process.env.NODE_ENV = 'test';
process.env.APP_SECRET = 'test-secret-test-secret-test-secret';
process.env.LOCAL_STORAGE_DIR = '.data/test-files';
process.env.LOG_LEVEL = 'silent';

beforeAll(async () => {
  // Base URI looks like mongodb://127.0.0.1:PORT/?replicaSet=testset — insert a per-worker database name before the query.
  const uri = String(process.env.MONGODB_URI_TEST).replace('/?', `/eayni_test_${process.pid}?`);
  await connectDb(uri);
  await ensureBaseline();
});

beforeEach(async () => {
  const collections = await mongoose.connection.db!.collections();
  for (const c of collections) {
    if (c.collectionName === 'roles' || c.collectionName === 'workflowdefs') continue;
    await c.deleteMany({});
  }
  clearSettingsCache();
  clearRoleCache();
  clearWorkflowCache();
  clearSubscribers();
});

afterAll(async () => {
  await mongoose.connection.db?.dropDatabase();
  await disconnectDb();
});
