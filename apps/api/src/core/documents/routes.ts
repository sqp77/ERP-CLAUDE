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

export const documentsRouter = Router();

documentsRouter.get(
  '/',
  requireAuth(),
  authorize('documents', 'view'),
  validate(z.object({ ownerType: z.string(), ownerId: z.string(), includeOld: z.coerce.boolean().optional() }), 'query'),
  asyncHandler(async (req: AuthedRequest, res) => {
    const q = req.query as unknown as { ownerType: string; ownerId: string; includeOld?: boolean };
    const items = await DocumentRecord.find({ ownerType: q.ownerType, ownerId: q.ownerId, deletedAt: null }).sort({ type: 1, version: -1 }).lean();
    const latest = q.includeOld ? items : items.filter((d, i, arr) => arr.findIndex((x) => x.type === d.type) === i);
    if (latest.some((d) => d.sensitive)) {
      await recordAudit(actorFrom(req), { action: 'view', resource: 'documents', resourceId: `${q.ownerType}:${q.ownerId}`, sensitive: true });
    }
    res.json({ items: latest });
  }),
);

documentsRouter.post(
  '/',
  requireAuth(),
  authorize('documents', 'create'),
  validate(createDocumentSchema),
  asyncHandler(async (req: AuthedRequest, res) => {
    const body = req.body as z.infer<typeof createDocumentSchema>;
    const prev = await DocumentRecord.findOne({ ownerType: body.ownerType, ownerId: body.ownerId, type: body.type, deletedAt: null }).sort({ version: -1 });
    const doc = await DocumentRecord.create({ ...body, uploadedBy: req.auth.user._id, version: (prev?.version ?? 0) + 1, previousId: prev?._id });
    await recordAudit(actorFrom(req), { action: 'create', resource: 'documents', resourceId: String(doc._id), after: doc, sensitive: body.sensitive });
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
    await recordAudit(actorFrom(req), { action: 'delete', resource: 'documents', resourceId: String(doc._id), before: doc });
    res.status(204).end();
  }),
);
