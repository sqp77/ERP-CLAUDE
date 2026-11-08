import { Router } from 'express';
import { z } from 'zod';
import { createDocumentSchema } from '@eayni/shared';
import { asyncHandler } from '../http/async';
import { validate } from '../http/validate';
import { actorFrom, type AuthedRequest } from '../http/context';
import { notFound } from '../http/errors';
import { requireAuth } from '../auth/middleware';
import { authorize } from '../rbac/authorize';
import { recordAudit } from '../audit/service';
import { DocumentRecord } from './model';
import { canAccessDocuments } from './access';
import { canViewSensitive } from '../access/registry';
import { Attachment } from '../files/model';
import { claimAttachments } from '../files/service';
import { forbidden } from '../http/errors';

export const documentsRouter = Router();

documentsRouter.get(
  '/',
  requireAuth(),
  authorize('documents', 'view'),
  validate(
    z.object({ ownerType: z.string(), ownerId: z.string(), includeOld: z.coerce.boolean().optional() }),
    'query',
  ),
  asyncHandler(async (req: AuthedRequest, res) => {
    const q = req.query as unknown as { ownerType: string; ownerId: string; includeOld?: boolean };
    if (!(await canAccessDocuments(req, q.ownerType, q.ownerId))) throw forbidden();
    const items = await DocumentRecord.find({ ownerType: q.ownerType, ownerId: q.ownerId, deletedAt: null })
      .sort({ type: 1, version: -1 })
      .lean();
    const latest = q.includeOld
      ? items
      : items.filter((d, i, arr) => arr.findIndex((x) => x.type === d.type) === i);
    // Sensitive documents: type and expiry for everyone who may see the record; the file only for sensitive viewers (review E2).
    const sensitiveOk = latest.some((d) => d.sensitive)
      ? await canViewSensitive(req, q.ownerType, q.ownerId)
      : false;
    if (sensitiveOk) {
      await recordAudit(actorFrom(req), {
        action: 'view',
        resource: 'documents',
        resourceId: `${q.ownerType}:${q.ownerId}`,
        sensitive: true,
      });
    }
    res.json({
      items: latest.map((d) =>
        d.sensitive && !sensitiveOk ? { ...d, attachmentId: undefined, restricted: true } : d,
      ),
    });
  }),
);

documentsRouter.post(
  '/',
  requireAuth(),
  authorize('documents', 'create'),
  validate(createDocumentSchema),
  asyncHandler(async (req: AuthedRequest, res) => {
    const body = req.body as z.infer<typeof createDocumentSchema>;
    if (!(await canAccessDocuments(req, body.ownerType, body.ownerId))) throw forbidden();
    // Sensitivity by type (review E2, follow-up 3): identity, contract and bank proof are always sensitive; 'other' is
    // sensitive unless HR explicitly unticks it; everything else is what the caller said (default not sensitive).
    const sensitive =
      body.ownerType === 'employee' && ['identity', 'contract', 'bank_proof'].includes(body.type)
        ? true
        : body.type === 'other'
          ? body.sensitive !== false
          : body.sensitive === true;
    body.sensitive = sensitive;
    // The file must be the caller's own upload and unowned or already owned by this record (follow-up 4).
    await claimAttachments([body.attachmentId], body.ownerType, body.ownerId, req.auth.user._id);
    const prev = await DocumentRecord.findOne({
      ownerType: body.ownerType,
      ownerId: body.ownerId,
      type: body.type,
      deletedAt: null,
    }).sort({ version: -1 });
    const doc = await DocumentRecord.create({
      ...body,
      uploadedBy: req.auth.user._id,
      version: (prev?.version ?? 0) + 1,
      previousId: prev?._id,
    });
    // The file inherits the document's sensitivity (review E2).
    if (sensitive) await Attachment.updateOne({ _id: body.attachmentId }, { $set: { sensitive: true } });
    await recordAudit(actorFrom(req), {
      action: 'create',
      resource: 'documents',
      resourceId: String(doc._id),
      after: doc,
      sensitive: body.sensitive,
    });
    res.status(201).json(doc);
  }),
);

documentsRouter.delete(
  '/:id',
  requireAuth(),
  authorize('documents', 'delete'),
  asyncHandler(async (req: AuthedRequest, res) => {
    const doc = await DocumentRecord.findOne({ _id: req.params.id, deletedAt: null });
    if (!doc) throw notFound();
    doc.deletedAt = new Date();
    await doc.save();
    await recordAudit(actorFrom(req), {
      action: 'delete',
      resource: 'documents',
      resourceId: String(doc._id),
      before: doc,
    });
    res.status(204).end();
  }),
);
