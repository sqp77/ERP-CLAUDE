import { Router } from 'express';
import type { z } from 'zod';
import {
  createSalesRequestSchema,
  delayReasonSchema,
  listSalesRequestsQuerySchema,
  rentalInspectionSchema,
  salesRequestTransitionSchema,
  scrapAssessmentSchema,
  scrapTaskSchema,
  scrapTaskUpdateSchema,
  updateSalesRequestSchema,
  type CreateSalesRequestInput,
  type RentalInspectionInput,
  type SalesRequestTransitionInput,
  type ScrapAssessmentInput,
  type ScrapTaskInput,
} from '@eayni/shared';
import { asyncHandler } from '../../core/http/async';
import { validate } from '../../core/http/validate';
import type { AuthedRequest } from '../../core/http/context';
import { requireAuth } from '../../core/auth/middleware';
import { authorize } from '../../core/rbac/authorize';
import { getSetting } from '../../core/settings/service';
import * as svc from './requests.service';

/**
 * Sales service requests [SAL §5, §6]. Sales roles create and edit; the receiving departments (Procurement, Finance,
 * Operations) read their queue and fire their own transitions — authorization is per transition and per department
 * inside the service (Q12), so these routes only require a session.
 */
export const salesRequestsRouter = Router();

/** Q7 lists (empty until the owner sends them) and which incoming queues the caller may see. */
salesRequestsRouter.get(
  '/meta',
  requireAuth(),
  asyncHandler(async (req: AuthedRequest, res) => {
    res.json({ lists: await getSetting('sales.lists'), incomingHolders: await svc.incomingHoldersFor(req) });
  }),
);

salesRequestsRouter.post(
  '/',
  requireAuth(),
  authorize('sales.requests', 'create'),
  validate(createSalesRequestSchema),
  asyncHandler(async (req: AuthedRequest, res) => {
    res.status(201).json(await svc.createRequest(req, req.body as CreateSalesRequestInput));
  }),
);
salesRequestsRouter.get(
  '/',
  requireAuth(),
  validate(listSalesRequestsQuerySchema, 'query'),
  asyncHandler(async (req: AuthedRequest, res) => {
    res.json(await svc.listRequests(req, req.query as unknown as svc.ListQuery));
  }),
);
salesRequestsRouter.get(
  '/:id',
  requireAuth(),
  asyncHandler(async (req: AuthedRequest, res) => {
    res.json(await svc.getRequest(req, req.params.id));
  }),
);
salesRequestsRouter.patch(
  '/:id',
  requireAuth(),
  validate(updateSalesRequestSchema),
  asyncHandler(async (req: AuthedRequest, res) => {
    res.json(await svc.updateRequest(req, req.params.id, req.body as Record<string, unknown>));
  }),
);
salesRequestsRouter.post(
  '/:id/transition',
  requireAuth(),
  validate(salesRequestTransitionSchema),
  asyncHandler(async (req: AuthedRequest, res) => {
    res.json(await svc.transitionRequest(req, req.params.id, req.body as SalesRequestTransitionInput));
  }),
);
salesRequestsRouter.post(
  '/:id/stage-log/:entryId/delay-reason',
  requireAuth(),
  validate(delayReasonSchema),
  asyncHandler(async (req: AuthedRequest, res) => {
    res.json(
      await svc.setDelayReason(
        req,
        req.params.id,
        req.params.entryId,
        req.body as z.infer<typeof delayReasonSchema>,
      ),
    );
  }),
);
salesRequestsRouter.post(
  '/:id/inspections',
  requireAuth(),
  validate(rentalInspectionSchema),
  asyncHandler(async (req: AuthedRequest, res) => {
    res.status(201).json(await svc.addInspection(req, req.params.id, req.body as RentalInspectionInput));
  }),
);
salesRequestsRouter.post(
  '/:id/assessments',
  requireAuth(),
  validate(scrapAssessmentSchema),
  asyncHandler(async (req: AuthedRequest, res) => {
    res.status(201).json(await svc.addAssessment(req, req.params.id, req.body as ScrapAssessmentInput));
  }),
);
salesRequestsRouter.post(
  '/:id/tasks',
  requireAuth(),
  validate(scrapTaskSchema),
  asyncHandler(async (req: AuthedRequest, res) => {
    res.status(201).json(await svc.addScrapTask(req, req.params.id, req.body as ScrapTaskInput));
  }),
);
salesRequestsRouter.patch(
  '/:id/tasks/:taskId',
  requireAuth(),
  validate(scrapTaskUpdateSchema),
  asyncHandler(async (req: AuthedRequest, res) => {
    res.json(
      await svc.updateScrapTask(
        req,
        req.params.id,
        req.params.taskId,
        req.body as z.infer<typeof scrapTaskUpdateSchema>,
      ),
    );
  }),
);
