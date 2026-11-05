import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { auth, loginAs, makeUser, testApp } from '../../test/helpers';
import { AuditLog } from '../audit/model';
import { registerRecordAccess, registerSensitiveOwnerType } from '../access/registry';

const app = () => testApp();

describe('files: presigned upload/download with the local adapter [CLAUDE.md Files]', () => {
  it('presigns, uploads bytes directly, then serves a signed download; sensitive downloads are audited', async () => {
    await makeUser('u@eayni.local');
    const t = await loginAs('u@eayni.local');
    // Sensitivity follows the owner type on the server (security review A3); the client flag is ignored.
    registerSensitiveOwnerType('test_contract');
    registerRecordAccess('test_contract', async () => true);
    const pre = await request(app())
      .post('/api/v1/files/presign')
      .set(auth(t))
      .send({
        fileName: 'contract.pdf',
        mimeType: 'application/pdf',
        size: 11,
        ownerType: 'test_contract',
        ownerId: 'c1',
      });
    expect(pre.status).toBe(201);
    const uploadUrl = new URL(pre.body.upload.url);
    const put = await request(app())
      .put(uploadUrl.pathname + uploadUrl.search)
      .set('Content-Type', 'application/pdf')
      .send(Buffer.from('%PDF-1.4 ok'));
    expect(put.status).toBe(200);
    const done = await request(app()).post(`/api/v1/files/${pre.body.attachmentId}/complete`).set(auth(t));
    expect(done.body.status).toBe('uploaded');
    const url = await request(app()).get(`/api/v1/files/${pre.body.attachmentId}/url`).set(auth(t));
    expect(url.status).toBe(200);
    const dl = new URL(url.body.url);
    const got = await request(app()).get(dl.pathname + dl.search);
    expect(got.status).toBe(200);
    expect(got.headers['content-type']).toContain('application/pdf');
    expect(await AuditLog.countDocuments({ resource: 'files', action: 'download', sensitive: true })).toBe(1);
  });

  it('rejects disallowed types and tampered signatures', async () => {
    await makeUser('v@eayni.local');
    const t = await loginAs('v@eayni.local');
    const bad = await request(app())
      .post('/api/v1/files/presign')
      .set(auth(t))
      .send({ fileName: 'x.exe', mimeType: 'application/x-msdownload', size: 10 });
    expect(bad.status).toBe(400);
    const pre = await request(app())
      .post('/api/v1/files/presign')
      .set(auth(t))
      .send({ fileName: 'a.png', mimeType: 'image/png', size: 3 });
    const u = new URL(pre.body.upload.url);
    u.searchParams.set('sig', 'forged');
    expect(
      (
        await request(app())
          .put(u.pathname + u.search)
          .send(Buffer.from('abc'))
      ).status,
    ).toBe(403);
  });
});
