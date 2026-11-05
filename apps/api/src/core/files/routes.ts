import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';
import { presignUploadSchema } from '@eayni/shared';
import type { z } from 'zod';
import { asyncHandler } from '../http/async';
import { validate } from '../http/validate';
import { actorFrom, type AuthedRequest } from '../http/context';
import { badRequest, forbidden, notFound } from '../http/errors';
import { requireAuth } from '../auth/middleware';
import { authorize } from '../rbac/authorize';
import { recordAudit } from '../audit/service';
import { canAccessRecord, isSensitiveOwnerType } from '../access/registry';
import { Attachment, type AttachmentDoc } from './model';
import { localStorageAdapter, signLocal, storage } from './storage';

export const filesRouter = Router();

/**
 * Who may read an attachment (security review A3): its uploader; anyone who may access the owner
 * record; otherwise only 'all' scope on files. Files with no owner stay private to the uploader.
 */
async function canReadAttachment(
  req: AuthedRequest,
  att: Pick<AttachmentDoc, 'uploadedBy' | 'ownerType' | 'ownerId'>,
) {
  if (String(att.uploadedBy) === String(req.auth.user._id)) return true;
  if (att.ownerType && att.ownerId) return canAccessRecord(req, att.ownerType, att.ownerId);
  return req.authz?.scope === 'all';
}

/** Step 1: ask for an upload target. Step 2: browser PUTs the bytes there. Step 3: confirm. */
filesRouter.post(
  '/presign',
  requireAuth(),
  authorize('files', 'create'),
  validate(presignUploadSchema),
  asyncHandler(async (req: AuthedRequest, res) => {
    const body = req.body as z.infer<typeof presignUploadSchema>;
    // Uploading straight onto a record requires access to that record; sensitivity is decided here, never by the client.
    if (body.ownerType && body.ownerId && !(await canAccessRecord(req, body.ownerType, body.ownerId)))
      throw forbidden();
    const ext = extname(body.fileName).toLowerCase().slice(0, 10);
    const now = new Date();
    const key = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${randomUUID()}${ext}`;
    const att = await Attachment.create({
      key,
      originalName: body.fileName,
      mimeType: body.mimeType,
      size: body.size,
      uploadedBy: req.auth.user._id,
      ownerType: body.ownerType,
      ownerId: body.ownerId,
      sensitive: isSensitiveOwnerType(body.ownerType),
    });
    const upload = await storage().createUploadUrl(key, body.mimeType, body.size);
    res.status(201).json({ attachmentId: String(att._id), key, upload });
  }),
);

filesRouter.post(
  '/:id/complete',
  requireAuth(),
  authorize('files', 'create'),
  asyncHandler(async (req: AuthedRequest, res) => {
    const att = await Attachment.findOne({ _id: req.params.id, deletedAt: null });
    if (!att) throw notFound();
    if (String(att.uploadedBy) !== String(req.auth.user._id) && req.authz?.scope !== 'all') throw forbidden();
    if (att.status !== 'uploaded') {
      att.status = 'uploaded';
      att.uploadedAt = new Date();
      await att.save();
      await recordAudit(actorFrom(req), {
        action: 'create',
        resource: 'files',
        resourceId: String(att._id),
        after: att,
      });
    }
    res.json(att);
  }),
);

filesRouter.get(
  '/:id',
  requireAuth(),
  authorize('files', 'view'),
  asyncHandler(async (req: AuthedRequest, res) => {
    const att = await Attachment.findOne({ _id: req.params.id, deletedAt: null }).lean();
    if (!att) throw notFound();
    if (!(await canReadAttachment(req, att))) throw forbidden();
    res.json(att);
  }),
);

/** Download URL. Downloads of sensitive files are audited (golden rule 4). */
filesRouter.get(
  '/:id/url',
  requireAuth(),
  authorize('files', 'view'),
  asyncHandler(async (req: AuthedRequest, res) => {
    const att = await Attachment.findOne({ _id: req.params.id, deletedAt: null, status: 'uploaded' }).lean();
    if (!att) throw notFound();
    if (!(await canReadAttachment(req, att))) throw forbidden();
    const out = await storage().createDownloadUrl(att.key, att.originalName, att.mimeType);
    if (att.sensitive) {
      await recordAudit(actorFrom(req), {
        action: 'download',
        resource: 'files',
        resourceId: String(att._id),
        sensitive: true,
        meta: { ownerType: att.ownerType, ownerId: att.ownerId },
      });
    }
    res.json(out);
  }),
);

filesRouter.delete(
  '/:id',
  requireAuth(),
  authorize('files', 'delete'),
  asyncHandler(async (req: AuthedRequest, res) => {
    const att = await Attachment.findOne({ _id: req.params.id, deletedAt: null });
    if (!att) throw notFound();
    if (String(att.uploadedBy) !== String(req.auth.user._id) && req.authz?.scope !== 'all') throw forbidden();
    att.deletedAt = new Date();
    await att.save();
    await recordAudit(actorFrom(req), {
      action: 'delete',
      resource: 'files',
      resourceId: String(att._id),
      before: att,
    });
    res.status(204).end();
  }),
);

/** Local-disk upload/download endpoints (development only; S3 presigned URLs replace them in deployed stages). */
filesRouter.put(
  '/local/:key',
  asyncHandler(async (req, res) => {
    const local = localStorageAdapter();
    if (!local) throw notFound();
    const key = decodeURIComponent(req.params.key);
    const exp = Number(req.query.exp);
    const size = Number(req.query.size);
    const mime = String(req.query.mime ?? '');
    if (!exp || exp < Date.now()) throw badRequest('انتهت صلاحية رابط الرفع');
    if (req.query.sig !== signLocal('put', key, exp, `${mime}|${size}`)) throw forbidden('توقيع غير صالح');
    const written = await local.write(key, req);
    if (written > size) {
      await local.delete(key);
      throw badRequest('حجم الملف أكبر من المصرّح به');
    }
    await Attachment.updateOne(
      { key, status: 'pending' },
      { $set: { status: 'uploaded', uploadedAt: new Date(), size: written } },
    );
    res.status(200).json({ ok: true, size: written });
  }),
);

filesRouter.get(
  '/local/:key',
  asyncHandler(async (req, res) => {
    const local = localStorageAdapter();
    if (!local) throw notFound();
    const key = decodeURIComponent(req.params.key);
    const exp = Number(req.query.exp);
    if (!exp || exp < Date.now()) throw badRequest('انتهت صلاحية رابط التنزيل');
    if (req.query.sig !== signLocal('get', key, exp)) throw forbidden('توقيع غير صالح');
    if (!local.exists(key)) throw notFound();
    const att = await Attachment.findOne({ key }).lean();
    const name = String(req.query.name ?? att?.originalName ?? 'file');
    res.setHeader('Content-Type', att?.mimeType ?? 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(name)}`);
    local.read(key).pipe(res);
  }),
);
