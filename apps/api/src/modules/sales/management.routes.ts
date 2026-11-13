import { Router } from 'express';
import type { z } from 'zod';
import {
  createLibraryDocSchema,
  listSalesTargetsQuerySchema,
  salesDashboardQuerySchema,
  salesKpiQuerySchema,
  setSalesTargetSchema,
  withdrawSalesTargetSchema,
} from '@eayni/shared';
import { asyncHandler } from '../../core/http/async';
import { validate } from '../../core/http/validate';
import type { AuthedRequest } from '../../core/http/context';
import { requireAuth } from '../../core/auth/middleware';
import { authorize } from '../../core/rbac/authorize';
import * as svc from './management.service';

/**
 * Sales management and follow-up [SAL §17 المرحلة الرابعة]: targets (§11.1), KPIs (§11, §11.2), dashboard (§13),
 * documents library (§8.2). Mounted at `/api/v1/sales/management` before the generic Sales router.
 */
export const salesManagementRouter = Router();

salesManagementRouter.get(
  '/targets',
  requireAuth(),
  authorize('sales.targets', 'view'),
  validate(listSalesTargetsQuerySchema, 'query'),
  asyncHandler(async (req: AuthedRequest, res) => {
    res.json(await svc.listTargets(req, req.query as z.infer<typeof listSalesTargetsQuerySchema>));
  }),
);
salesManagementRouter.post(
  '/targets',
  requireAuth(),
  authorize('sales.targets', 'edit'),
  validate(setSalesTargetSchema),
  asyncHandler(async (req: AuthedRequest, res) => {
    res.status(201).json(await svc.setTarget(req, req.body as z.infer<typeof setSalesTargetSchema>));
  }),
);
salesManagementRouter.post(
  '/targets/:id/withdraw',
  requireAuth(),
  authorize('sales.targets', 'edit'),
  validate(withdrawSalesTargetSchema),
  asyncHandler(async (req: AuthedRequest, res) => {
    const { reason } = req.body as z.infer<typeof withdrawSalesTargetSchema>;
    res.status(201).json(await svc.withdrawTarget(req, req.params.id, reason));
  }),
);

salesManagementRouter.get(
  '/kpi',
  requireAuth(),
  authorize('sales.kpi', 'view'),
  validate(salesKpiQuerySchema, 'query'),
  asyncHandler(async (req: AuthedRequest, res) => {
    res.json(await svc.salesKpis(req, req.query as z.infer<typeof salesKpiQuerySchema>));
  }),
);

salesManagementRouter.get(
  '/dashboard',
  requireAuth(),
  authorize('sales.dashboard', 'view'),
  validate(salesDashboardQuerySchema, 'query'),
  asyncHandler(async (req: AuthedRequest, res) => {
    res.json(await svc.salesDashboard(req, req.query as z.infer<typeof salesDashboardQuerySchema>));
  }),
);

salesManagementRouter.get(
  '/library',
  requireAuth(),
  authorize('sales.library', 'view'),
  asyncHandler(async (req: AuthedRequest, res) => {
    res.json(await svc.listLibrary(req));
  }),
);
salesManagementRouter.get(
  '/library/:id/history',
  requireAuth(),
  authorize('sales.library', 'view'),
  asyncHandler(async (req: AuthedRequest, res) => {
    res.json(await svc.libraryHistory(req, req.params.id));
  }),
);
salesManagementRouter.post(
  '/library',
  requireAuth(),
  authorize('sales.library', 'create'),
  validate(createLibraryDocSchema),
  asyncHandler(async (req: AuthedRequest, res) => {
    res.status(201).json(await svc.createLibraryDoc(req, req.body as z.infer<typeof createLibraryDocSchema>));
  }),
);
salesManagementRouter.delete(
  '/library/:id',
  requireAuth(),
  authorize('sales.library', 'delete'),
  asyncHandler(async (req: AuthedRequest, res) => {
    await svc.deleteLibraryDoc(req, req.params.id);
    res.status(204).end();
  }),
);
