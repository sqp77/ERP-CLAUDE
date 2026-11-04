import { DEPARTMENT_CODES, DEPARTMENT_NAMES_AR } from '@eayni/shared';
import { env } from './config';
import { logger } from './logger';
import { connectDb, disconnectDb } from './db';
import { ensureBaseline } from './bootstrap';
import { User } from './core/auth/model';
import { hashPassword } from './core/auth/crypto';
import { Branch, Department, Position, Site } from './core/org/model';
import { Holiday } from './core/dates/model';
import { startDevMongo } from './devMongo';
import { seedHr } from './seedHr';
import { seedRequests } from './seedRequests';

/**
 * The seed carries a default admin password and sample data. It may only ever run against the local
 * development database: loopback host, no Atlas/SRV, never in production.
 */
export function assertLocalDatabase(uri: string | undefined): void {
  if (env().NODE_ENV === 'production') throw new Error('seed refused: NODE_ENV=production');
  if (!uri) throw new Error('seed refused: no database URI');
  if (uri.startsWith('mongodb+srv://'))
    throw new Error('seed refused: SRV/Atlas URI is not a local database');
  const host = new URL(uri.replace(/^mongodb:\/\//, 'http://')).hostname;
  if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(host))
    throw new Error(`seed refused: ${host} is not a local database`);
}

/**
 * Local seed: departments (DECISIONS §3), sample branch/site/positions (sample data only — real
 * branches are pending), national holidays placeholders, and one system admin.
 * Re-runnable: existing records are kept.
 */
export async function seed(): Promise<{
  adminEmail: string;
  adminPassword: string | undefined;
  sampleEmployees: number;
  sampleLogins: { email: string; role: string }[];
  samplePassword: string;
}> {
  await ensureBaseline();
  for (const code of DEPARTMENT_CODES) {
    await Department.updateOne(
      { code },
      { $setOnInsert: { code, nameAr: DEPARTMENT_NAMES_AR[code], active: true } },
      { upsert: true },
    );
  }
  const hq = await Branch.findOneAndUpdate(
    { code: 'hq' },
    {
      $setOnInsert: {
        code: 'hq',
        nameAr: 'المقر الرئيسي (بيانات تجريبية)',
        region: 'المنطقة الشرقية',
        city: 'الدمام',
        active: true,
      },
    },
    { upsert: true, new: true },
  );
  await Site.updateOne(
    { branchId: hq!._id, nameAr: 'موقع التشغيل الرئيسي (تجريبي)' },
    {
      $setOnInsert: {
        branchId: hq!._id,
        nameAr: 'موقع التشغيل الرئيسي (تجريبي)',
        location: { type: 'Point', coordinates: [50.1, 26.43] },
        geofenceRadiusM: 200,
        active: true,
      },
    },
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
  const samplePassword = process.env.SEED_SAMPLE_PASSWORD ?? 'Sample12345!';
  const hr = await seedHr(samplePassword);
  const requests = await seedRequests();
  logger.info({ requests }, 'sample HR requests');
  return { adminEmail, adminPassword, sampleEmployees: hr.created, sampleLogins: hr.logins, samplePassword };
}

const isMain = process.argv[1]?.endsWith('seed.ts') || process.argv[1]?.endsWith('seed.js');
if (isMain) {
  (async () => {
    let uri = env().MONGODB_URI;
    let stop = async () => {};
    if (!uri && env().DEV_AUTO_MONGO) ({ uri, stop } = await startDevMongo());
    assertLocalDatabase(uri);
    await connectDb(uri);
    const r = await seed();
    await disconnectDb();
    await stop();
    logger.info(r, 'seed done');
  })().catch((err) => {
    logger.error({ err }, 'seed failed');
    process.exit(1);
  });
}
