import mongoose from 'mongoose';
import { DEPARTMENT_CODES, DEPARTMENT_NAMES_AR } from '@eayni/shared';
import { env } from '../config';
import { logger } from '../logger';
import { ensureBaseline } from '../bootstrap';
import { User } from '../core/auth/model';
import { hashPassword, randomToken } from '../core/auth/crypto';
import { generateTemporaryPassword } from '../core/auth/service';
import { Department } from '../core/org/model';
import { recordAudit } from '../core/audit/service';
import { SYSTEM_ACTOR } from '../core/http/context';
import { seedHr } from '../seedHr';
import { seedRequests } from '../seedRequests';
import { seedTasks } from '../seedTasks';
import { seedTickets } from '../seedTickets';
import { seedNews } from '../seedNews';
import { seedEmployeeReports } from '../seedEmployeeReports';
import { seedSales } from '../seedSales';
import { Branch, Site } from '../core/org/model';
import { Holiday } from '../core/dates/model';
import { DemoRecord } from './demo.model';

/**
 * First run on a deployed stage (staging readiness item 1): the official departments (DECISIONS §3) and the
 * first system admin. No sample branches, sites, positions or people — those belong to the local seed only.
 * Refuses when an active system admin already exists; the admin's temporary password is returned once.
 */
export async function bootstrapStage(input: { adminEmail: string; displayNameAr?: string }): Promise<{
  adminEmail: string;
  temporaryPassword: string;
  departments: number;
}> {
  const adminEmail = input.adminEmail.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(adminEmail)) throw new Error('adminEmail is not a valid email');
  await ensureBaseline();
  let departments = 0;
  for (const code of DEPARTMENT_CODES) {
    const r = await Department.updateOne(
      { code },
      { $setOnInsert: { code, nameAr: DEPARTMENT_NAMES_AR[code], active: true } },
      { upsert: true },
    );
    if (r.upsertedCount) departments++;
  }
  if (await User.exists({ 'roles.role': 'system_admin', status: 'active', deletedAt: null }))
    throw new Error('bootstrap refused: an active system admin already exists (use the users screen)');
  if (await User.exists({ email: adminEmail }))
    throw new Error(`bootstrap refused: a user with email ${adminEmail} already exists`);
  const it = await Department.findOne({ code: 'it' }).select('_id').lean();
  const temporaryPassword = await generateTemporaryPassword();
  const user = await User.create({
    email: adminEmail,
    displayNameAr: input.displayNameAr?.trim() || 'مدير النظام',
    passwordHash: await hashPassword(temporaryPassword),
    passwordChangedAt: new Date(),
    roles: [{ role: 'system_admin' }, { role: 'employee' }],
    departmentId: it?._id,
    mustChangePassword: true, // forced change on first login; TOTP enrolment follows from auth.mfaRequiredRoles (DECISIONS §2)
  });
  await recordAudit(SYSTEM_ACTOR, {
    action: 'create',
    resource: 'users',
    resourceId: String(user._id),
    after: { email: adminEmail, roles: ['system_admin', 'employee'] },
    meta: { bootstrap: true, stage: env().STAGE ?? null, departmentsCreated: departments },
  });
  logger.info(
    { adminEmail, departments },
    'stage bootstrapped (temporary password returned to the caller only)',
  );
  return { adminEmail, temporaryPassword, departments };
}

/** Collections the demo purge never touches: baseline config, logs that must stay append-only, counters. */
const KEEP = new Set([
  'roles',
  'workflowdefs',
  'settings',
  'auditlogs',
  'loginlogs',
  'counters',
  'demo_records',
  'tags', // baseline config [SAL §10.4]
]);

async function snapshotIds(): Promise<Map<string, Set<string>>> {
  const db = mongoose.connection.db!;
  const out = new Map<string, Set<string>>();
  for (const c of await db.listCollections().toArray()) {
    if (KEEP.has(c.name)) continue;
    const ids = await db.collection(c.name).distinct('_id');
    out.set(c.name, new Set(ids.map(String)));
  }
  return out;
}

/** Only the staging stage may load demo people (item 3): never prod/production, never an unnamed production process. */
export function assertStagingDemoAllowed(e: { STAGE?: string; NODE_ENV: string } = env()): void {
  if (e.STAGE !== 'staging')
    throw new Error(`demo seed refused: stage is ${e.STAGE ?? '(unset)'}; only "staging" may load demo data`);
}

/**
 * Staging demo data: the same sample people as the local seed, each account with its own random password that is
 * returned once (never stored, never logged). Every created document is tagged in `demo_records`, so `purgeDemo`
 * removes exactly that set before real data arrives.
 */
export async function seedStagingDemo(): Promise<{
  batch: string;
  accounts: { email: string; password: string }[];
  tagged: Record<string, number>;
}> {
  assertStagingDemoAllowed();
  await ensureBaseline();
  for (const code of DEPARTMENT_CODES) {
    await Department.updateOne(
      { code },
      { $setOnInsert: { code, nameAr: DEPARTMENT_NAMES_AR[code], active: true } },
      { upsert: true },
    );
  }
  const before = await snapshotIds();
  const passwords = new Map<string, string>();
  const passwordFor = (email: string) => {
    const p = passwords.get(email) ?? `Demo-${randomToken(9)}`;
    passwords.set(email, p);
    return p;
  };
  // The local seed's branch/site exist only as sample context for the sample people; tagged and purged with them.
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
  for (const h of [
    { date: '2026-09-23', nameAr: 'اليوم الوطني' },
    { date: '2026-02-22', nameAr: 'يوم التأسيس' },
  ])
    await Holiday.updateOne({ date: h.date }, { $setOnInsert: h }, { upsert: true });
  await seedHr(passwordFor);
  await seedRequests();
  await seedTasks(passwordFor);
  await seedTickets();
  await seedNews();
  await seedEmployeeReports();
  await seedSales();
  const after = await snapshotIds();
  const batch = new Date().toISOString();
  const tagged: Record<string, number> = {};
  for (const [name, ids] of after) {
    const prev = before.get(name) ?? new Set<string>();
    const fresh = [...ids].filter((id) => !prev.has(id));
    if (!fresh.length) continue;
    const raw = await mongoose.connection
      .db!.collection(name)
      .find({}, { projection: { _id: 1 } })
      .toArray();
    const docs = raw.filter((d) => fresh.includes(String(d._id)));
    await DemoRecord.insertMany(
      docs.map((d) => ({ collectionName: name, docId: d._id, batch })),
      { ordered: false },
    ).catch(() => undefined);
    tagged[name] = docs.length;
  }
  const accounts = [...passwords.entries()].map(([email, password]) => ({ email, password }));
  logger.info(
    { batch, tagged, accounts: accounts.length },
    'staging demo data loaded (passwords returned to the caller only)',
  );
  return { batch, accounts, tagged };
}

/** Remove everything the demo seed created (item 3); baseline config, audit and login logs stay. */
export async function purgeDemo(): Promise<Record<string, number>> {
  const db = mongoose.connection.db!;
  const removed: Record<string, number> = {};
  const tags = await DemoRecord.find().lean();
  const byCollection = new Map<string, unknown[]>();
  for (const t of tags)
    byCollection.set(t.collectionName, [...(byCollection.get(t.collectionName) ?? []), t.docId]);
  for (const [name, ids] of byCollection) {
    if (KEEP.has(name)) continue;
    const r = await db.collection(name).deleteMany({ _id: { $in: ids as never[] } });
    removed[name] = r.deletedCount ?? 0;
  }
  await DemoRecord.deleteMany({});
  await recordAudit(SYSTEM_ACTOR, {
    action: 'delete',
    resource: 'demo_data',
    meta: { removed, stage: env().STAGE ?? null },
  });
  logger.info({ removed }, 'demo data purged');
  return removed;
}
