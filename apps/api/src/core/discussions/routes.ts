import { Router } from 'express';
import type { z } from 'zod';
import {
  createDiscussionSchema,
  discussionMessageSchema,
  discussionParticipantsSchema,
  discussionStateSchema,
  listDiscussionsQuerySchema,
} from '@eayni/shared';
import { asyncHandler } from '../http/async';
import { validate } from '../http/validate';
import type { AuthedRequest } from '../http/context';
import { requireAuth } from '../auth/middleware';
import { authorize } from '../rbac/authorize';
import * as svc from './service';

/** Department discussions [SAL §10.3]. Record-level checks live in the service. */
export const discussionsRouter = Router();

discussionsRouter.get(
  '/',
  requireAuth(),
  authorize('discussions', 'view'),
  validate(listDiscussionsQuerySchema, 'query'),
  asyncHandler(async (req: AuthedRequest, res) => {
    res.json(await svc.listDiscussions(req, req.query as unknown as svc.ListDiscussionsQuery));
  }),
);
discussionsRouter.post(
  '/',
  requireAuth(),
  authorize('discussions', 'create'),
  validate(createDiscussionSchema),
  asyncHandler(async (req: AuthedRequest, res) => {
    res.status(201).json(await svc.openDiscussion(req, req.body as z.infer<typeof createDiscussionSchema>));
  }),
);
discussionsRouter.get(
  '/:id',
  requireAuth(),
  authorize('discussions', 'view'),
  asyncHandler(async (req: AuthedRequest, res) => {
    res.json(await svc.getDiscussion(req, req.params.id));
  }),
);
discussionsRouter.post(
  '/:id/messages',
  requireAuth(),
  authorize('discussions', 'view'),
  validate(discussionMessageSchema),
  asyncHandler(async (req: AuthedRequest, res) => {
    const { body, attachmentIds } = req.body as z.infer<typeof discussionMessageSchema>;
    res.status(201).json(await svc.addMessage(req, req.params.id, body, attachmentIds));
  }),
);
discussionsRouter.post(
  '/:id/state',
  requireAuth(),
  authorize('discussions', 'view'),
  validate(discussionStateSchema),
  asyncHandler(async (req: AuthedRequest, res) => {
    const { state, note } = req.body as z.infer<typeof discussionStateSchema>;
    res.json(await svc.setState(req, req.params.id, state, note));
  }),
);
discussionsRouter.post(
  '/:id/participants',
  requireAuth(),
  authorize('discussions', 'view'),
  validate(discussionParticipantsSchema),
  asyncHandler(async (req: AuthedRequest, res) => {
    const { userIds } = req.body as z.infer<typeof discussionParticipantsSchema>;
    res.json(await svc.addParticipants(req, req.params.id, userIds));
  }),
);
