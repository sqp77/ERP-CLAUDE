import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { createApp } from '../app';
import { resetEnvCache } from '../config';
import { parseViewerAddress, resetViewerAddressWarning } from './http/origin';
import { logger } from '../logger';
import { existsSync, statSync } from 'node:fs';
import { activateAccount, auth, loginAs, makeDepartment, makeUser, testApp, PASSWORD } from '../test/helpers';
import { setSetting } from './settings/service';
import { SYSTEM_ACTOR } from './http/context';
import { LoginLog, User } from './auth/model';
import { Attachment } from './files/model';
import { DocumentRecord } from './documents/model';

const app = () => testApp();

// CloudFormation short tags are opaque to the test: keep their payload so the structure can be asserted.
const CFN = yaml.DEFAULT_SCHEMA.extend(
  ['Ref', 'GetAtt', 'Sub', 'Select', 'Split', 'Join'].flatMap((tag) =>
    (['scalar', 'sequence', 'mapping'] as const).map(
      (kind) => new yaml.Type(`!${tag}`, { kind, construct: (data) => ({ [`Fn::${tag}`]: data }) }),
    ),
  ),
);
const serverless = () =>
  yaml.load(readFileSync(fileURLToPath(new URL('../../../../serverless.yml', import.meta.url)), 'utf8'), {
    schema: CFN,
  }) as {
    resources: { Resources: Record<string, { Type: string; Properties: Record<string, unknown> }> };
  };

async function upload(token: string, body: Record<string, unknown> = {}, mime = 'application/pdf') {
  const pre = await request(app())
    .post('/api/v1/files/presign')
    .set(auth(token))
    .send({ fileName: mime.startsWith('image/') ? 'p.png' : 'f.pdf', mimeType: mime, size: 11, ...body });
  expect(pre.status).toBe(201);
  const u = new URL(pre.body.upload.url);
  await request(app())
    .put(u.pathname + u.search)
    .set('Content-Type', mime)
    .send(
      mime.startsWith('image/') ? Buffer.from('\x89PNG\r\n\x1a\n000', 'binary') : Buffer.from('%PDF-1.4 ok'),
    );
  await request(app()).post(`/api/v1/files/${pre.body.attachmentId}/complete`).set(auth(token));
  return pre.body.attachmentId as string;
}

async function setup() {
  await setSetting('auth.mfaRequiredRoles', [], SYSTEM_ACTOR);
  const ops = await makeDepartment('ops', 'التشغيل');
  const it = await makeDepartment('it', 'التقنية');
  await makeUser('hr@eayni.local', [{ role: 'employee' }, { role: 'hr_officer' }]);
  const hr = await loginAs('hr@eayni.local');
  let n = 0;
  const mk = async (email: string, first: string, directManagerId?: string, dept: unknown = ops._id) => {
    const r = await request(app())
      .post('/api/v1/hr/employees')
      .set(auth(hr))
      .send({
        firstNameAr: first,
        lastNameAr: 'الزهراني',
        gender: 'male',
        nationality: 'سعودي',
        workEmail: email,
        identity: { type: 'national_id', number: `10${String(90000000 + ++n).padStart(8, '0')}` },
        hireDate: '2024-01-10',
        departmentId: String(dept),
        directManagerId,
      });
    expect(r.status).toBe(201);
    return {
      employeeId: r.body._id as string,
      userId: r.body.userId as string,
      token: await activateAccount(email, r.body.temporaryPassword),
    };
  };
  // boss: a direct manager by org chart only (no department-manager role).
  const boss = await mk('boss@eayni.local', 'سعد');
  const a = await mk('a@eayni.local', 'أحمد', boss.employeeId);
  const itStaff = await mk('it1@eayni.local', 'محمد', undefined, it._id);
  return { ops, it, hr, boss, a, itStaff, mk };
}

describe('go-live review follow-up (b02191a)', () => {
  it('1: no CustomErrorResponses; the SPA rewrite function sits on the default behaviour only and leaves /api and files alone', () => {
    const { Resources } = serverless().resources;
    const dist = Resources.WebDistribution.Properties.DistributionConfig as Record<string, unknown>;
    expect(dist.CustomErrorResponses).toBeUndefined();
    const def = dist.DefaultCacheBehavior as {
      FunctionAssociations?: { EventType: string; FunctionARN: unknown }[];
    };
    expect(def.FunctionAssociations).toHaveLength(1);
    expect(def.FunctionAssociations![0].EventType).toBe('viewer-request');
    expect(JSON.stringify(def.FunctionAssociations![0].FunctionARN)).toContain('WebSpaRewriteFunction');
    for (const b of dist.CacheBehaviors as { PathPattern: string; FunctionAssociations?: unknown }[]) {
      expect(b.FunctionAssociations, b.PathPattern).toBeUndefined();
    }
    const fn = Resources.WebSpaRewriteFunction;
    expect(fn.Type).toBe('AWS::CloudFront::Function');
    // Run the function body: routes → /index.html, files and /api/* untouched.
    const handler = new Function(`${fn.Properties.FunctionCode as string}; return handler;`)() as (e: {
      request: { uri: string };
    }) => { uri: string };
    expect(handler({ request: { uri: '/tasks/board' } }).uri).toBe('/index.html');
    expect(handler({ request: { uri: '/hr/employees/0123' } }).uri).toBe('/index.html');
    expect(handler({ request: { uri: '/' } }).uri).toBe('/index.html');
    expect(handler({ request: { uri: '/assets/app-1a2b.js' } }).uri).toBe('/assets/app-1a2b.js');
    expect(handler({ request: { uri: '/api/v1/auth/me' } }).uri).toBe('/api/v1/auth/me');
  });

  it('2: CloudFront adds the origin secret and forwards CloudFront-Viewer-Address; the API refuses other callers and reads the IP from that header', async () => {
    const { Resources } = serverless().resources;
    const dist = Resources.WebDistribution.Properties.DistributionConfig as {
      Origins: { Id: string; OriginCustomHeaders?: { HeaderName: string; HeaderValue: string }[] }[];
      CacheBehaviors: { PathPattern: string; OriginRequestPolicyId: unknown }[];
    };
    const api = dist.Origins.find((o) => o.Id === 'api')!;
    expect(api.OriginCustomHeaders?.map((h) => h.HeaderName)).toEqual(['x-origin-secret']);
    expect(api.OriginCustomHeaders![0].HeaderValue).toContain('origin-secret');
    // Managed AllViewerExceptHostHeader (follow-up on fffae18 item 1): API Gateway needs its own Host; this managed
    // policy is built for it and already forwards the CloudFront viewer headers (incl. CloudFront-Viewer-Address).
    expect(dist.CacheBehaviors.find((b) => b.PathPattern === '/api/*')!.OriginRequestPolicyId).toBe(
      'b689b0a8-53d0-40ab-baf2-68738e2966ac',
    );
    expect(Resources.ApiOriginRequestPolicy).toBeUndefined();
    expect(Object.values(Resources).some((r) => r.Type === 'AWS::CloudFront::OriginRequestPolicy')).toBe(
      false,
    );
    const env = (
      yaml.load(readFileSync(fileURLToPath(new URL('../../../../serverless.yml', import.meta.url)), 'utf8'), {
        schema: CFN,
      }) as { provider: { environment: Record<string, string> } }
    ).provider.environment;
    expect(env.ORIGIN_SECRET).toContain('origin-secret');
    expect(env.TRUST_PROXY_HOPS).toBe('0'); // no hop counting any more

    expect(parseViewerAddress('203.0.113.9:51234')).toBe('203.0.113.9');
    expect(parseViewerAddress('2001:db8::1:51234')).toBe('2001:db8::1');
    expect(parseViewerAddress(undefined)).toBeUndefined();

    await makeUser('u@eayni.local');
    process.env.ORIGIN_SECRET = 'origin-secret-for-tests-0123456789';
    resetEnvCache();
    try {
      const guarded = createApp();
      expect((await request(guarded).get('/api/health')).status).toBe(200); // monitors stay open
      const direct = await request(guarded).get('/api/v1/auth/me');
      expect(direct.status).toBe(403);
      expect(direct.body.error.code).toBe('forbidden_origin');
      expect(
        (
          await request(guarded)
            .get('/api/v1/auth/me')
            .set('x-origin-secret', 'wrong-secret-wrong-secret-000')
        ).status,
      ).toBe(403);
      const viaCdn = await request(guarded)
        .get('/api/v1/auth/me')
        .set('x-origin-secret', 'origin-secret-for-tests-0123456789');
      expect(viaCdn.status).toBe(401); // passed the origin check, just not logged in
      // The IP comes from CloudFront-Viewer-Address; a spoofed X-Forwarded-For is ignored.
      const login = await request(guarded)
        .post('/api/v1/auth/login')
        .set('x-origin-secret', 'origin-secret-for-tests-0123456789')
        .set('cloudfront-viewer-address', '203.0.113.9:51234')
        .set('x-forwarded-for', '10.0.0.1, 1.1.1.1')
        .send({ email: 'u@eayni.local', password: 'not-the-password' });
      expect(login.status).toBe(401);
      const log = await LoginLog.findOne({ email: 'u@eayni.local', event: 'login_failed' })
        .sort({ at: -1 })
        .lean();
      expect(log?.ip).toBe('203.0.113.9');
    } finally {
      delete process.env.ORIGIN_SECRET;
      resetEnvCache();
    }
  });

  it('3: org-chart access reaches only the photo and secondment reports; documents of type "other" are sensitive unless HR unticks it', async () => {
    const { hr, boss, a } = await setup();
    // a's photo: reachable by the direct manager.
    const photo = await upload(a.token, {}, 'image/png');
    expect(
      (await request(app()).post('/api/v1/hr/me/photo').set(auth(a.token)).send({ attachmentId: photo }))
        .status,
    ).toBe(200);
    expect((await request(app()).get(`/api/v1/files/${photo}/url`).set(auth(boss.token))).status).toBe(200);
    // An "other" document uploaded by HR: sensitive by default → listed restricted, file refused to the manager.
    const other = await request(app())
      .post('/api/v1/documents')
      .set(auth(hr))
      .send({
        ownerType: 'employee',
        ownerId: a.employeeId,
        type: 'other',
        titleAr: 'تقرير طبي',
        attachmentId: await upload(hr),
      });
    expect(other.status).toBe(201);
    expect(other.body.sensitive).toBe(true);
    expect((await Attachment.findById(other.body.attachmentId))?.sensitive).toBe(true);
    const list = await request(app())
      .get(`/api/v1/documents?ownerType=employee&ownerId=${a.employeeId}`)
      .set(auth(boss.token));
    expect(list.status).toBe(200);
    const row = list.body.items.find((d: { _id: string }) => d._id === other.body._id);
    expect(row).toMatchObject({ restricted: true });
    expect(row.attachmentId).toBeUndefined();
    expect(
      (await request(app()).get(`/api/v1/files/${other.body.attachmentId}/url`).set(auth(boss.token))).status,
    ).toBe(403);
    // HR unticks: not sensitive — but the org chart still does not open it (only photo and secondment reports).
    const plain = await request(app())
      .post('/api/v1/documents')
      .set(auth(hr))
      .send({
        ownerType: 'employee',
        ownerId: a.employeeId,
        type: 'other',
        titleAr: 'شهادة دورة',
        attachmentId: await upload(hr),
        sensitive: false,
      });
    expect(plain.status).toBe(201);
    expect(plain.body.sensitive).toBe(false);
    expect(
      (await request(app()).get(`/api/v1/files/${plain.body.attachmentId}/url`).set(auth(boss.token))).status,
    ).toBe(403);
    // Identity copies cannot be unticked.
    const idDoc = await request(app())
      .post('/api/v1/documents')
      .set(auth(hr))
      .send({
        ownerType: 'employee',
        ownerId: a.employeeId,
        type: 'identity',
        titleAr: 'هوية',
        attachmentId: await upload(hr),
        sensitive: false,
      });
    expect(idDoc.body.sensitive).toBe(true);
    // The employee and HR open their files; the employee sees the plain document's attachment id.
    expect(
      (await request(app()).get(`/api/v1/files/${plain.body.attachmentId}/url`).set(auth(a.token))).status,
    ).toBe(200);
    expect(
      (await request(app()).get(`/api/v1/files/${other.body.attachmentId}/url`).set(auth(hr))).status,
    ).toBe(200);
  });

  it("4: POST /documents only claims the caller's own unowned (or same-record) upload", async () => {
    const { hr, a, mk } = await setup();
    const b = await mk('b@eayni.local', 'بدر');
    const base = { ownerType: 'employee', ownerId: a.employeeId, type: 'certificate', titleAr: 'شهادة' };
    // Someone else's upload: refused, nothing re-owned.
    const foreign = await upload(b.token);
    expect(
      (
        await request(app())
          .post('/api/v1/documents')
          .set(auth(hr))
          .send({ ...base, attachmentId: foreign })
      ).status,
    ).toBe(400);
    expect((await Attachment.findById(foreign))?.ownerType).toBeFalsy();
    // HR's own upload already attached to another record (b's file): refused.
    const owned = await upload(hr, { ownerType: 'employee', ownerId: b.employeeId });
    expect(
      (
        await request(app())
          .post('/api/v1/documents')
          .set(auth(hr))
          .send({ ...base, attachmentId: owned })
      ).status,
    ).toBe(400);
    expect(String((await Attachment.findById(owned))?.ownerId)).toBe(b.employeeId);
    // HR's upload already presigned for this very record: accepted; an unowned one too.
    const same = await upload(hr, { ownerType: 'employee', ownerId: a.employeeId });
    expect(
      (
        await request(app())
          .post('/api/v1/documents')
          .set(auth(hr))
          .send({ ...base, attachmentId: same })
      ).status,
    ).toBe(201);
    const fresh = await upload(hr);
    expect(
      (
        await request(app())
          .post('/api/v1/documents')
          .set(auth(hr))
          .send({ ...base, attachmentId: fresh })
      ).status,
    ).toBe(201);
    expect((await Attachment.findById(fresh))?.ownerId).toBe(a.employeeId);
    expect(await DocumentRecord.countDocuments({ ownerId: a.employeeId })).toBe(2);
  });

  it('5: the manager dashboard card and tickets?view=team use one filter, even with the staff queue off', async () => {
    const { ops, hr, boss, a, itStaff } = await setup();
    await setSetting('tickets.hiddenTargets', [], SYSTEM_ACTOR);
    await setSetting('tickets.staffQueueDepartments', { ops: false }, SYSTEM_ACTOR); // boss sees no department queue
    await makeUser(
      'opsmgr@eayni.local',
      [{ role: 'employee' }, { role: 'department_manager', departmentId: String(ops._id) }],
      { departmentId: ops._id },
    );
    const opsmgr = await loginAs('opsmgr@eayni.local');
    const created = await request(app()).post('/api/v1/tickets').set(auth(itStaff.token)).send({
      departmentCode: 'ops',
      type: 'request',
      subject: 'نقل حاوية',
      body: 'نحتاج نقل حاوية الفرع',
      priority: 'medium',
    });
    expect(created.status).toBe(201);
    expect(
      (
        await request(app())
          .post(`/api/v1/tickets/${created.body._id}/transition`)
          .set(auth(opsmgr))
          .send({ transition: 'assign', assigneeId: a.userId })
      ).status,
    ).toBe(200);
    const dash = await request(app()).get('/api/v1/hr/dashboard/manager').set(auth(boss.token));
    expect(dash.status).toBe(200);
    expect(dash.body.tickets.open).toBe(1);
    const list = await request(app()).get('/api/v1/tickets?view=team&open=true').set(auth(boss.token));
    expect(list.body.items.map((x: { _id: string }) => x._id)).toEqual([created.body._id]);
    // The direct manager can also open the ticket; an unrelated employee cannot; HR (own scope, no reports) sees an empty team list.
    expect(
      (await request(app()).get(`/api/v1/tickets/${created.body._id}`).set(auth(boss.token))).status,
    ).toBe(200);
    expect(
      (
        await request(app())
          .get(`/api/v1/tickets/${created.body._id}`)
          .set(auth((await makeUser('x@eayni.local'), await loginAs('x@eayni.local'))))
      ).status,
    ).toBe(404);
    expect((await request(app()).get('/api/v1/tickets?view=team').set(auth(hr))).body.items).toEqual([]);
    expect(PASSWORD).toBeTruthy();
    expect(await User.countDocuments({ email: 'boss@eayni.local' })).toBe(1);
  });

  it('fffae18 follow-up 2d/4: the previous origin secret is accepted during rotation; a missing viewer address leaves the IP unknown (no shared limiter key) and warns once', async () => {
    await makeUser('v@eayni.local');
    process.env.ORIGIN_SECRET = 'origin-secret-current-0123456789';
    process.env.ORIGIN_SECRET_PREVIOUS = 'origin-secret-previous-0123456789';
    resetEnvCache();
    resetViewerAddressWarning();
    const warn = vi.spyOn(logger, 'warn');
    try {
      const guarded = createApp();
      expect(
        (
          await request(guarded)
            .get('/api/v1/auth/me')
            .set('x-origin-secret', 'origin-secret-current-0123456789')
        ).status,
      ).toBe(401);
      expect(
        (
          await request(guarded)
            .get('/api/v1/auth/me')
            .set('x-origin-secret', 'origin-secret-previous-0123456789')
        ).status,
      ).toBe(401);
      expect(
        (
          await request(guarded)
            .get('/api/v1/auth/me')
            .set('x-origin-secret', 'origin-secret-older-0123456789')
        ).status,
      ).toBe(403);
      // Through CloudFront but without CloudFront-Viewer-Address: login still works, the IP is not a made-up value.
      for (let i = 0; i < 2; i++) {
        const r = await request(guarded)
          .post('/api/v1/auth/login')
          .set('x-origin-secret', 'origin-secret-current-0123456789')
          .set('x-forwarded-for', '10.0.0.1')
          .send({ email: 'v@eayni.local', password: 'wrong-password' });
        expect(r.status).toBe(401);
      }
      const log = await LoginLog.findOne({ email: 'v@eayni.local', event: 'login_failed' })
        .sort({ at: -1 })
        .lean();
      expect(log?.ip ?? undefined).toBeUndefined();
      const ok = await request(guarded)
        .post('/api/v1/auth/login')
        .set('x-origin-secret', 'origin-secret-current-0123456789')
        .send({ email: 'v@eayni.local', password: PASSWORD });
      expect(ok.status).toBe(200);
      const missingWarnings = warn.mock.calls.filter((c) =>
        String(c[1] ?? c[0]).includes('CloudFront-Viewer-Address missing'),
      );
      expect(missingWarnings).toHaveLength(1); // once per container, not per request
    } finally {
      warn.mockRestore();
      delete process.env.ORIGIN_SECRET;
      delete process.env.ORIGIN_SECRET_PREVIOUS;
      resetEnvCache();
    }
  });

  it('fffae18 follow-up 2/3: the smoke and deploy scripts exist, are executable, and upload index.html with no-cache and assets as immutable', () => {
    const root = fileURLToPath(new URL('../../../../', import.meta.url));
    for (const f of ['scripts/smoke-staging.sh', 'scripts/deploy-web.sh']) {
      expect(existsSync(root + f), f).toBe(true);
      expect(statSync(root + f).mode & 0o111, `${f} executable`).not.toBe(0);
    }
    const deploy = readFileSync(root + 'scripts/deploy-web.sh', 'utf8');
    expect(deploy).toMatch(/--exclude ['"]?index\.html/);
    expect(deploy).toMatch(/max-age=31536000,\s*immutable/);
    expect(deploy).toMatch(/index\.html[\s\S]*--cache-control ['"]no-cache/);
    const smoke = readFileSync(root + 'scripts/smoke-staging.sh', 'utf8');
    for (const must of [
      '/api/health',
      '/api/v1/auth/me',
      'forbidden_origin',
      '/api/v1/auth/sessions',
      'execute-api',
    ]) {
      expect(smoke, must).toContain(must);
    }
  });
});
