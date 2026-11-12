import { Router } from 'express';
import type { z } from 'zod';
import {
  createOpportunitySchema,
  listOpportunitiesQuerySchema,
  opportunityStageSchema,
  reassignOpportunitiesSchema,
  updateOpportunitySchema,
  type CreateOpportunityInput,
  type OpportunityStageInput,
} from '@eayni/shared';
import { asyncHandler } from '../../core/http/async';
import { validate } from '../../core/http/validate';
import type { AuthedRequest } from '../../core/http/context';
import { requireAuth } from '../../core/auth/middleware';
import { authorize } from '../../core/rbac/authorize';
import * as svc from './service';

export const salesRouter = Router();

/** Landing counters [SAL §18 «الواجهة الرئيسية لقسم المبيعات»]. */
salesRouter.get(
  '/home',
  requireAuth(),
  authorize('sales.opportunities', 'view'),
  asyncHandler(async (req: AuthedRequest, res) => {
    res.json(await svc.salesHome(req));
  }),
);

salesRouter.get(
  '/opportunities/pipeline',
  requireAuth(),
  authorize('sales.opportunities', 'view'),
  asyncHandler(async (req: AuthedRequest, res) => {
    const owner = typeof req.query.ownerUserId === 'string' ? req.query.ownerUserId : undefined;
    res.json({ stages: await svc.pipelineSummary(req, owner) });
  }),
);
salesRouter.post(
  '/opportunities/reassign',
  requireAuth(),
  authorize('sales.opportunities', 'approve'),
  validate(reassignOpportunitiesSchema),
  asyncHandler(async (req: AuthedRequest, res) => {
    res.json(await svc.reassignOpportunities(req, req.body as z.infer<typeof reassignOpportunitiesSchema>));
  }),
);
salesRouter.post(
  '/opportunities',
  requireAuth(),
  authorize('sales.opportunities', 'create'),
  validate(createOpportunitySchema),
  asyncHandler(async (req: AuthedRequest, res) => {
    res.status(201).json(await svc.createOpportunity(req, req.body as CreateOpportunityInput));
  }),
);
salesRouter.get(
  '/opportunities',
  requireAuth(),
  authorize('sales.opportunities', 'view'),
  validate(listOpportunitiesQuerySchema, 'query'),
  asyncHandler(async (req: AuthedRequest, res) => {
    res.json(await svc.listOpportunities(req, req.query as unknown as svc.ListOpportunitiesQuery));
  }),
);
salesRouter.get(
  '/opportunities/:id',
  requireAuth(),
  authorize('sales.opportunities', 'view'),
  asyncHandler(async (req: AuthedRequest, res) => {
    res.json(await svc.getOpportunity(req, req.params.id));
  }),
);
salesRouter.patch(
  '/opportunities/:id',
  requireAuth(),
  authorize('sales.opportunities', 'edit'),
  validate(updateOpportunitySchema),
  asyncHandler(async (req: AuthedRequest, res) => {
    res.json(await svc.updateOpportunity(req, req.params.id, req.body as Record<string, unknown>));
  }),
);
salesRouter.post(
  '/opportunities/:id/stage',
  requireAuth(),
  authorize('sales.opportunities', 'edit'),
  validate(opportunityStageSchema),
  asyncHandler(async (req: AuthedRequest, res) => {
    res.json(await svc.changeStage(req, req.params.id, req.body as OpportunityStageInput));
  }),
);
