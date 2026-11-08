import { Router } from 'express';
import { z } from 'zod';
import { arabicSearchRegex, createNewsSchema, listNewsQuerySchema, newsDecisionSchema, updateNewsSchema, type CreateNewsInput } from '@eayni/shared';
import { asyncHandler } from '../../core/http/async';
import { validate } from '../../core/http/validate';
import type { AuthedRequest } from '../../core/http/context';
import { requireAuth } from '../../core/auth/middleware';
import { authorize } from '../../core/rbac/authorize';
import { Attachment } from '../../core/files/model';
import { Department } from '../../core/org/model';
import { News } from './model';
import * as svc from './service';

export const newsRouter = Router();

newsRouter.get(
  '/departments',
  requireAuth(),
  asyncHandler(async (req: AuthedRequest, res) => {
    res.json({ items: await svc.publishableDepartments(req.auth.user) });
  }),
);

newsRouter.get(
  '/',
  requireAuth(),
  authorize('news', 'view'),
  validate(listNewsQuerySchema, 'query'),
  asyncHandler(async (req: AuthedRequest, res) => {
    const q = req.query as unknown as z.infer<typeof listNewsQuerySchema>;
    const now = new Date();
    const filter: Record<string, unknown> = { deletedAt: null, ...(await svc.visibilityFilter(req.auth.user, req.authz!, now)) };
    if (q.view === 'feed') Object.assign(filter, { state: 'published', publishFrom: { $lte: now }, $and: [{ $or: [{ publishTo: null }, { publishTo: { $gte: now } }] }] });
    if (q.view === 'archive') Object.assign(filter, { $and: [{ $or: [{ state: 'archived' }, { state: 'published', publishTo: { $lt: now } }] }] });
    if (q.view === 'pending') filter.state = 'pending_approval';
    if (q.view === 'manage') filter.state = { $ne: 'archived' };
    if (q.departmentCode) filter.departmentCode = q.departmentCode;
    if (q.q) filter.title = arabicSearchRegex(q.q);
    const sort: Record<string, 1 | -1> = q.view === 'feed' ? { pinned: -1, publishedAt: -1 } : { updatedAt: -1 };
    const [items, total] = await Promise.all([
      News.find(filter).sort(sort).skip((q.page - 1) * q.limit).limit(q.limit).select('-body').lean(),
      News.countDocuments(filter),
    ]);
    const depts = await Department.find({ _id: { $in: items.map((i) => i.departmentId) } }).select('nameAr').lean();
    const names = new Map(depts.map((d) => [String(d._id), d.nameAr]));
    res.json({ items: items.map((i) => ({ ...i, departmentName: names.get(String(i.departmentId)) })), total, page: q.page, limit: q.limit });
  }),
);

newsRouter.post(
  '/',
  requireAuth(),
  authorize('news', 'create'),
  validate(createNewsSchema),
  asyncHandler(async (req: AuthedRequest, res) => {
    res.status(201).json(await svc.createNews(req, req.body as CreateNewsInput));
  }),
);

newsRouter.get(
  '/:id',
  requireAuth(),
  authorize('news', 'view'),
  asyncHandler(async (req: AuthedRequest, res) => {
    const n = await svc.findVisible(req, req.params.id);
    const [attachments, dept, caps, hist] = await Promise.all([
      Attachment.find({ _id: { $in: [...n.attachmentIds, ...(n.coverAttachmentId ? [n.coverAttachmentId] : [])] } }).select('originalName mimeType size').lean(),
      Department.findById(n.departmentId).select('nameAr').lean(),
      svc.viewerCapabilities(req.auth.user, n),
      svc.history(String(n._id)),
    ]);
    res.json({ ...n.toObject(), attachments, departmentName: dept?.nameAr, ...caps, history: hist });
  }),
);

newsRouter.patch(
  '/:id',
  requireAuth(),
  authorize('news', 'view'),
  validate(updateNewsSchema),
  asyncHandler(async (req: AuthedRequest, res) => {
    res.json(await svc.updateNews(req, await svc.findVisible(req, req.params.id), req.body as Partial<CreateNewsInput>));
  }),
);

newsRouter.post('/:id/submit', requireAuth(), authorize('news', 'view'), asyncHandler(async (req: AuthedRequest, res) => {
  res.json(await svc.submitNews(req, await svc.findVisible(req, req.params.id)));
}));

newsRouter.post(
  '/:id/decide',
  requireAuth(),
  authorize('news', 'view'),
  validate(newsDecisionSchema),
  asyncHandler(async (req: AuthedRequest, res) => {
    const { approve, reason } = req.body as z.infer<typeof newsDecisionSchema>;
    res.json(await svc.decideNews(req, await svc.findVisible(req, req.params.id), approve, reason));
  }),
);

newsRouter.post('/:id/archive', requireAuth(), authorize('news', 'view'), asyncHandler(async (req: AuthedRequest, res) => {
  res.json(await svc.archiveNews(req, await svc.findVisible(req, req.params.id)));
}));

newsRouter.post(
  '/:id/pin',
  requireAuth(),
  authorize('news', 'view'),
  validate(z.object({ pinned: z.boolean() })),
  asyncHandler(async (req: AuthedRequest, res) => {
    res.json(await svc.setPinned(req, await svc.findVisible(req, req.params.id), (req.body as { pinned: boolean }).pinned));
  }),
);
