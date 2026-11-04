import { Router } from 'express';
import type { z } from 'zod';
import { saveDraftSchema } from '@eayni/shared';
import { asyncHandler } from '../http/async';
import { validate } from '../http/validate';
import type { AuthedRequest } from '../http/context';
import { requireAuth } from '../auth/middleware';
import { Draft } from './model';

export const draftsRouter = Router();

draftsRouter.get(
  '/',
  requireAuth(),
  asyncHandler(async (req: AuthedRequest, res) => {
    const { formKey, recordId = '' } = req.query as { formKey?: string; recordId?: string };
    const filter: Record<string, unknown> = { userId: req.auth.user._id };
    if (formKey) Object.assign(filter, { formKey, recordId });
    res.json({ items: await Draft.find(filter).sort({ updatedAt: -1 }).lean() });
  }),
);

draftsRouter.put(
  '/',
  requireAuth(),
  validate(saveDraftSchema),
  asyncHandler(async (req: AuthedRequest, res) => {
    const body = req.body as z.infer<typeof saveDraftSchema>;
    const doc = await Draft.findOneAndUpdate(
      { userId: req.auth.user._id, formKey: body.formKey, recordId: body.recordId ?? '' },
      { $set: { data: body.data } },
      { upsert: true, new: true },
    ).lean();
    res.json(doc);
  }),
);

draftsRouter.delete(
  '/:id',
  requireAuth(),
  asyncHandler(async (req: AuthedRequest, res) => {
    await Draft.deleteOne({ _id: req.params.id, userId: req.auth.user._id });
    res.status(204).end();
  }),
);
