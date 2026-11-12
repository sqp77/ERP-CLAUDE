import { Router } from 'express';
import { z } from 'zod';
import { TAG_SCOPES, tagSchema } from '@eayni/shared';
import { asyncHandler } from '../http/async';
import { validate } from '../http/validate';
import { actorFrom, type AuthedRequest } from '../http/context';
import { badRequest, notFound } from '../http/errors';
import { requireAuth } from '../auth/middleware';
import { authorize } from '../rbac/authorize';
import { recordAudit } from '../audit/service';
import { Tag } from './model';
import { normalizeTag, renameTagOnRecords } from './service';

export const tagsRouter = Router();
const scopeQuery = z.object({ scope: z.enum(TAG_SCOPES) });

/** Tags of a scope, for pickers and filters [SAL §10.4]. */
tagsRouter.get(
  '/',
  requireAuth(),
  authorize('tags', 'view'),
  validate(scopeQuery, 'query'),
  asyncHandler(async (req, res) => {
    const { scope } = req.query as z.infer<typeof scopeQuery>;
    res.json({ items: await Tag.find({ scope }).sort({ name: 1 }).lean() });
  }),
);

/** Add a tag — department manager (`tags:create`, department scope) [SAL §10.4 «وفق صلاحيات مدير القسم»]. */
tagsRouter.post(
  '/',
  requireAuth(),
  authorize('tags', 'create'),
  validate(tagSchema.extend({ scope: z.enum(TAG_SCOPES) })),
  asyncHandler(async (req: AuthedRequest, res) => {
    const body = req.body as z.infer<typeof tagSchema> & { scope: string };
    const normalizedName = normalizeTag(body.name);
    if (await Tag.exists({ scope: body.scope, normalizedName })) throw badRequest('الوسم موجود مسبقًا');
    const tag = await Tag.create({ ...body, normalizedName, createdByUserId: req.auth.user._id });
    await recordAudit(actorFrom(req), {
      action: 'create',
      resource: 'tags',
      resourceId: String(tag._id),
      after: tag,
    });
    res.status(201).json(tag);
  }),
);

tagsRouter.patch(
  '/:id',
  requireAuth(),
  authorize('tags', 'edit'),
  validate(tagSchema.partial()),
  asyncHandler(async (req: AuthedRequest, res) => {
    const before = await Tag.findById(req.params.id).lean();
    if (!before) throw notFound();
    const body = req.body as Partial<z.infer<typeof tagSchema>>;
    const set: Record<string, unknown> = {};
    if (body.color !== undefined) set.color = body.color;
    if (body.name && normalizeTag(body.name) !== before.normalizedName) {
      if (await Tag.exists({ scope: before.scope, normalizedName: normalizeTag(body.name) }))
        throw badRequest('الوسم موجود مسبقًا');
      set.name = body.name;
      set.normalizedName = normalizeTag(body.name);
    } else if (body.name) set.name = body.name;
    const after = await Tag.findByIdAndUpdate(req.params.id, { $set: set }, { new: true }).lean();
    if (set.name && set.name !== before.name)
      await renameTagOnRecords(before.scope, before.name, String(set.name));
    await recordAudit(actorFrom(req), {
      action: 'update',
      resource: 'tags',
      resourceId: req.params.id,
      before,
      after,
    });
    res.json(after);
  }),
);

tagsRouter.delete(
  '/:id',
  requireAuth(),
  authorize('tags', 'delete'),
  asyncHandler(async (req: AuthedRequest, res) => {
    const before = await Tag.findById(req.params.id).lean();
    if (!before) throw notFound();
    await Tag.deleteOne({ _id: before._id });
    await renameTagOnRecords(before.scope, before.name, '');
    await recordAudit(actorFrom(req), {
      action: 'delete',
      resource: 'tags',
      resourceId: req.params.id,
      before,
    });
    res.status(204).end();
  }),
);
