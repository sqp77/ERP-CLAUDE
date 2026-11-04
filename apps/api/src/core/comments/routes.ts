import { Router } from 'express';
import { z, type z as Z } from 'zod';
import { createCommentSchema } from '@eayni/shared';
import { asyncHandler } from '../http/async';
import { validate } from '../http/validate';
import { actorFrom, type AuthedRequest } from '../http/context';
import { requireAuth } from '../auth/middleware';
import { authorize } from '../rbac/authorize';
import { recordAudit } from '../audit/service';
import { notify } from '../notifications/service';
import { Comment } from './model';

export const commentsRouter = Router();

commentsRouter.get(
  '/',
  requireAuth(),
  authorize('comments', 'view'),
  validate(z.object({ recordType: z.string(), recordId: z.string() }), 'query'),
  asyncHandler(async (req, res) => {
    const { recordType, recordId } = req.query as { recordType: string; recordId: string };
    res.json({ items: await Comment.find({ recordType, recordId }).sort({ createdAt: 1 }).lean() });
  }),
);

commentsRouter.post(
  '/',
  requireAuth(),
  authorize('comments', 'create'),
  validate(createCommentSchema),
  asyncHandler(async (req: AuthedRequest, res) => {
    const body = req.body as Z.infer<typeof createCommentSchema>;
    const c = await Comment.create({ ...body, authorId: req.auth.user._id });
    await recordAudit(actorFrom(req), {
      action: 'create',
      resource: 'comments',
      resourceId: String(c._id),
      after: c,
    });
    const mentions = body.mentionUserIds.filter((id) => id !== String(req.auth.user._id));
    if (mentions.length)
      await notify({
        userIds: mentions,
        type: 'comment.mention',
        bodyAr: body.body.slice(0, 140),
        data: { recordType: body.recordType, recordId: body.recordId },
      });
    res.status(201).json(c);
  }),
);
