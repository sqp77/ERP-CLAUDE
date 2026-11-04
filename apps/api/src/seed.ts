import { mkdirSync } from 'node:fs';
import { DEPARTMENT_CODES, DEPARTMENT_NAMES_AR } from '@eayni/shared';
import { env } from './config';
import { logger } from './logger';
import { connectDb, disconnectDb } from './db';
import { ensureBaseline } from './bootstrap';
import { User } from './core/auth/model';
import { hashPassword } from './core/auth/crypto';
import { Branch, Department, Position, Site } from './core/org/model';
import { Holiday } from './core/dates/model';

/**
 * Local seed: departments (DECISIONS §3), sample branch/site/positions (sample data only — real
 * branches are pending), national holidays placeholders, and one system admin.
 * Re-runnable: existing records are kept.
 */
export async function seed(): Promise<{ adminEmail: string; adminPassword: string | undefined }> {
  await ensureBaseline();
  for (const code of DEPARTMENT_CODES) {
    await Department.updateOne({ code }, { $setOnInsert: { code, nameAr: DEPARTMENT_NAMES_AR[code], active: true } }, { upsert: true });
  }
  const hq = await Branch.findOneAndUpdate(
    { code: 'hq' },
    { $setOnInsert: { code: 'hq', nameAr: 'المقر الرئيسي (بيانات تجريبية)', region: 'المنطقة الشرقية', city: 'الدمام', active: true } },
    { upsert: true, new: true },
  );
  await Site.updateOne(
    { branchId: hq!._id, nameAr: 'موقع التشغيل الرئيسي (تجريبي)' },
    { $setOnInsert: { branchId: hq!._id, nameAr: 'موقع التشغيل الرئيسي (تجريبي)', location: { type: 'Point', coordinates: [50.1, 26.43] }, geofenceRadiusM: 200, active: true } },
    { upsert: true },
  );
  const itDept = await Department.findOne({ code: 'it' });
  for (const p of [
    { code: 'sys_admin', titleAr: 'مدير النظام', departmentId: itDept?._id },
    { code: 'it_support', titleAr: 'أخصائي دعم فني', departmentId: itDept?._id },
  ]) {
    await Position.updateOne({ code: p.code }, { $setOnInsert: { ...p, active: true } }, { upsert: true });
  }
  for (const h of [
    { date: '2026-09-23', nameAr: 'اليوم الوطني' },
    { date: '2026-02-22', nameAr: 'يوم التأسيس' },
  ]) {
    await Holiday.updateOne({ date: h.date }, { $setOnInsert: h }, { upsert: true });
  }

  const adminEmail = env().SEED_ADMIN_EMAIL.toLowerCase();
  const existing = await User.findOne({ email: adminEmail });
  let adminPassword: string | undefined;
  if (!existing) {
    adminPassword = env().SEED_ADMIN_PASSWORD;
    await User.create({
      email: adminEmail,
      displayNameAr: 'مدير النظام',
      passwordHash: await hashPassword(adminPassword),
      roles: [{ role: 'system_admin' }, { role: 'employee' }],
      departmentId: itDept?._id,
      mustChangePassword: true,
    });
  }
  return { adminEmail, adminPassword };
}

const isMain = process.argv[1]?.endsWith('seed.ts') || process.argv[1]?.endsWith('seed.js');
if (isMain) {
  (async () => {
    let uri = env().MONGODB_URI;
    if (!uri && env().DEV_AUTO_MONGO) {
      const { MongoMemoryReplSet } = await import('mongodb-memory-server');
      mkdirSync('.data/mongo', { recursive: true });
      const repl = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger', dbName: 'eayni' }, instanceOpts: [{ dbPath: '.data/mongo', storageEngine: 'wiredTiger' }] });
      uri = repl.getUri('eayni');
      await connectDb(uri);
      const r = await seed();
      await disconnectDb();
      await repl.stop();
      logger.info(r, 'seed done');
      return;
    }
    await connectDb(uri);
    const r = await seed();
    await disconnectDb();
    logger.info(r, 'seed done');
  })().catch((err) => {
    logger.error({ err }, 'seed failed');
    process.exit(1);
  });
}
