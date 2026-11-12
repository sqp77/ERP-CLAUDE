import { describe, expect, it } from 'vitest';
import { DEPARTMENT_CODES } from '@eayni/shared';
import request from 'supertest';
import { resetEnvCache } from '../config';
import { auth, loginAs, makeDepartment, makeUser, testApp, tokenFromCookies } from '../test/helpers';
import { assertStagingDemoAllowed, bootstrapStage, purgeDemo, seedStagingDemo } from './stage';
import { DemoRecord } from './demo.model';
import { User } from '../core/auth/model';
import { Role } from '../core/rbac/model';
import { AuditLog } from '../core/audit/model';
import { Branch, Department, Position, Site } from '../core/org/model';
import { Employee } from '../modules/hr/model';
import { Task } from '../core/tasks/model';
import { Ticket } from '../modules/tickets/model';

const app = () => testApp();

describe('staging readiness 1 — bootstrap Lambda: departments + first admin, once', () => {
  it('creates the DECISIONS §3 departments and one system admin with a temporary password; never sample data; audited', async () => {
    const r = await bootstrapStage({ adminEmail: 'Admin@Eayni.SA' });
    expect(r.adminEmail).toBe('admin@eayni.sa');
    expect(r.departments).toBe(10);
    expect(r.temporaryPassword.length).toBeGreaterThanOrEqual(12);
    const codes = (await Department.find().select('code').lean()).map((d) => d.code).sort();
    expect(codes).toEqual([...DEPARTMENT_CODES].sort()); // the ten of DECISIONS §3
    // No sample branches, sites, positions or people.
    expect(await Branch.countDocuments()).toBe(0);
    expect(await Site.countDocuments()).toBe(0);
    expect(await Position.countDocuments()).toBe(0);
    expect(await Employee.countDocuments()).toBe(0);
    const admin = await User.findOne({ email: 'admin@eayni.sa' }).lean();
    expect(admin?.mustChangePassword).toBe(true);
    expect(admin?.roles.map((x) => x.role).sort()).toEqual(['employee', 'system_admin']);
    expect(
      await AuditLog.countDocuments({
        resource: 'users',
        resourceId: String(admin!._id),
        'meta.bootstrap': true,
        system: true,
      }),
    ).toBe(1);
    // The temporary password logs in and forces a change (TOTP enrolment then follows from auth.mfaRequiredRoles).
    const login = await request(app())
      .post('/api/v1/auth/login')
      .send({ email: 'admin@eayni.sa', password: r.temporaryPassword });
    expect(login.status).toBe(200);
    const me = await request(app())
      .get('/api/v1/auth/me')
      .set(auth(tokenFromCookies(login)));
    expect(me.body.mustChangePassword).toBe(true);
    // Second run: refused, nothing changes.
    await expect(bootstrapStage({ adminEmail: 'second@eayni.sa' })).rejects.toThrow(/already exists/);
    expect(await User.countDocuments({ 'roles.role': 'system_admin' })).toBe(1);
    expect(await Department.countDocuments()).toBe(10);
  });

  it('refuses when an active system admin already exists, and rejects a bad email', async () => {
    await makeUser('root@eayni.local', [{ role: 'system_admin' }]);
    await expect(bootstrapStage({ adminEmail: 'new@eayni.sa' })).rejects.toThrow(
      /system admin already exists/,
    );
    expect(await User.countDocuments({ email: 'new@eayni.sa' })).toBe(0);
    await expect(bootstrapStage({ adminEmail: 'not-an-email' })).rejects.toThrow(/valid email/);
  });
});

describe('staging readiness 3 — demo data only on staging, random passwords, purgeable', () => {
  it('is refused outside the staging stage', () => {
    expect(() => assertStagingDemoAllowed({ NODE_ENV: 'production', STAGE: 'prod' })).toThrow(/refused/);
    expect(() => assertStagingDemoAllowed({ NODE_ENV: 'production', STAGE: 'production' })).toThrow(
      /refused/,
    );
    expect(() => assertStagingDemoAllowed({ NODE_ENV: 'production' })).toThrow(/refused/);
    expect(() => assertStagingDemoAllowed({ NODE_ENV: 'development' })).toThrow(/refused/);
    expect(() => assertStagingDemoAllowed({ NODE_ENV: 'production', STAGE: 'staging' })).not.toThrow();
    expect(() => seedStagingDemo()).rejects.toThrow(/refused/); // env has no STAGE in tests
  });

  it('loads the sample people with one random password each (returned once), tags every record, and purgeDemo removes exactly them', async () => {
    app(); // module handlers (workflow relations, record access) are registered by createApp, as in the Lambda's registerModules()
    await makeUser('root@eayni.local', [{ role: 'system_admin' }]); // a real admin that must survive the purge
    process.env.STAGE = 'staging';
    resetEnvCache();
    try {
      const r = await seedStagingDemo();
      expect(r.accounts.length).toBeGreaterThan(20);
      const passwords = new Set(r.accounts.map((a) => a.password));
      expect(passwords.size).toBe(r.accounts.length); // all distinct
      for (const a of r.accounts) expect(a.password).not.toBe('Sample12345!');
      expect(Object.values(r.tagged).reduce((s, n) => s + n, 0)).toBeGreaterThan(50);
      expect(await DemoRecord.countDocuments()).toBeGreaterThan(50);
      // A demo account logs in with its own password and nothing else.
      const omar = r.accounts.find((a) => a.email === 'omar@eayni.local')!;
      const ok = await request(app())
        .post('/api/v1/auth/login')
        .send({ email: omar.email, password: omar.password });
      expect(ok.status).toBe(200);
      expect(
        (
          await request(app())
            .post('/api/v1/auth/login')
            .send({ email: omar.email, password: 'Sample12345!' })
        ).status,
      ).toBe(401);
      expect(
        (
          await request(app())
            .get('/api/v1/auth/me')
            .set(auth(tokenFromCookies(ok)))
        ).status,
      ).toBe(200);
      const employees = await Employee.countDocuments();
      expect(employees).toBeGreaterThan(20);
      expect(await Task.countDocuments()).toBeGreaterThan(0);
      expect(await Ticket.countDocuments()).toBeGreaterThan(0);
      // Purge: demo people, tasks, tickets, branch and site gone; departments, roles, the real admin and audit rows stay.
      const removed = await purgeDemo();
      expect(removed.employees).toBe(employees);
      expect(await Employee.countDocuments()).toBe(0);
      expect(await Task.countDocuments()).toBe(0);
      expect(await Ticket.countDocuments()).toBe(0);
      expect(await Branch.countDocuments()).toBe(0);
      expect(await Site.countDocuments()).toBe(0);
      expect(await User.countDocuments({ email: 'omar@eayni.local' })).toBe(0);
      expect(await User.countDocuments({ email: 'root@eayni.local' })).toBe(1);
      expect(await Department.countDocuments()).toBe(10);
      expect(await Role.countDocuments()).toBeGreaterThan(0);
      expect(await DemoRecord.countDocuments()).toBe(0);
      expect(await AuditLog.countDocuments({ resource: 'demo_data', action: 'delete' })).toBe(1);
      expect(await AuditLog.countDocuments({ resource: 'hr.employees' })).toBeGreaterThan(0); // append-only log kept
      // The demo session is gone with its user.
      expect(
        (
          await request(app())
            .get('/api/v1/auth/me')
            .set(auth(tokenFromCookies(ok)))
        ).status,
      ).toBe(401);
    } finally {
      delete process.env.STAGE;
      resetEnvCache();
    }
  });
});

describe('staging readiness 2/4/5 — scripts and config', () => {
  it('first-deploy handles the app-url chicken-and-egg; deploy-web never deletes; prune and smoke exist; the stack exposes the API URL and the one-off functions', async () => {
    const { readFileSync, statSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const root = fileURLToPath(new URL('../../../../', import.meta.url));
    for (const f of [
      'scripts/first-deploy.sh',
      'scripts/prune-web-assets.sh',
      'scripts/deploy-web.sh',
      'scripts/smoke-staging.sh',
    ])
      expect(statSync(root + f).mode & 0o111, `${f} executable`).not.toBe(0);
    const first = readFileSync(root + 'scripts/first-deploy.sh', 'utf8');
    expect(first).toContain('placeholder');
    expect(first).toContain('WebDistributionDomain');
    expect(first).toContain('deploy-web.sh');
    expect(first).toContain('smoke-staging.sh');
    expect((first.match(/serverless deploy/g) ?? []).length).toBeGreaterThanOrEqual(2);
    const deploy = readFileSync(root + 'scripts/deploy-web.sh', 'utf8');
    expect(deploy).not.toMatch(/s3 sync[^\n]*--delete/);
    const prune = readFileSync(root + 'scripts/prune-web-assets.sh', 'utf8');
    expect(prune).toContain('_deploy/files.txt');
    expect(prune).toContain('LastModified');
    const smoke = readFileSync(root + 'scripts/smoke-staging.sh', 'utf8');
    expect(smoke).toContain('PASS (IPv6)');
    expect(smoke).toContain('session ip');
    const yml = readFileSync(root + 'serverless.yml', 'utf8');
    for (const must of [
      'HttpApiUrl:',
      'bootstrap:',
      'seedStagingDemo:',
      'purgeDemo:',
      'handlers/bootstrap.handler',
    ])
      expect(yml).toContain(must);
    expect(readFileSync(root + 'apps/web/src/main.tsx', 'utf8')).toContain("'vite:preloadError'");
    expect(makeDepartment).toBeTruthy();
    expect(loginAs).toBeTruthy();
  });
});
