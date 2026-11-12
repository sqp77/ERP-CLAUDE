import { Router } from 'express';
import type { z } from 'zod';
import {
  addMarketPriceSchema,
  addPriceEntrySchema,
  createPriceItemSchema,
  updatePriceItemSchema,
} from '@eayni/shared';
import { asyncHandler } from '../../core/http/async';
import { validate } from '../../core/http/validate';
import type { AuthedRequest } from '../../core/http/context';
import { requireAuth } from '../../core/auth/middleware';
import { authorize } from '../../core/rbac/authorize';
import { getSetting } from '../../core/settings/service';
import * as svc from './pricing.service';

/** قائمة الأسعار المركزية ومصفوفة الخصم [SAL §7.1, §7.2]. Reading needs `sales.pricelist:view`; writing the editor roles. */
export const pricingRouter = Router();

pricingRouter.get(
  '/',
  requireAuth(),
  authorize('sales.pricelist', 'view'),
  asyncHandler(async (req: AuthedRequest, res) => {
    const [limits, mode, editors] = await Promise.all([
      getSetting('sales.discountLimitBp'),
      getSetting('sales.quoteApprovalMode'),
      getSetting('sales.priceEditorRoles'),
    ]);
    res.json({
      items: await svc.listPriceList(req.query.includeInactive === 'true'),
      matrix: { limits, mode, limitsUnset: limits.rep === null || limits.manager === null },
      canEdit: req.auth.roleCodes.some((r) => editors.includes(r)),
    });
  }),
);
pricingRouter.post(
  '/items',
  requireAuth(),
  authorize('sales.pricelist', 'view'),
  validate(createPriceItemSchema),
  asyncHandler(async (req: AuthedRequest, res) => {
    res.status(201).json(await svc.createPriceItem(req, req.body as z.infer<typeof createPriceItemSchema>));
  }),
);
pricingRouter.patch(
  '/items/:id',
  requireAuth(),
  authorize('sales.pricelist', 'view'),
  validate(updatePriceItemSchema),
  asyncHandler(async (req: AuthedRequest, res) => {
    res.json(await svc.updatePriceItem(req, req.params.id, req.body as Record<string, unknown>));
  }),
);
pricingRouter.get(
  '/items/:id/history',
  requireAuth(),
  authorize('sales.pricelist', 'view'),
  asyncHandler(async (req: AuthedRequest, res) => {
    res.json(await svc.priceHistory(req.params.id));
  }),
);
pricingRouter.post(
  '/items/:id/prices',
  requireAuth(),
  authorize('sales.pricelist', 'view'),
  validate(addPriceEntrySchema),
  asyncHandler(async (req: AuthedRequest, res) => {
    res
      .status(201)
      .json(await svc.addPriceEntry(req, req.params.id, req.body as z.infer<typeof addPriceEntrySchema>));
  }),
);
pricingRouter.post(
  '/items/:id/market',
  requireAuth(),
  authorize('sales.pricelist', 'view'),
  validate(addMarketPriceSchema),
  asyncHandler(async (req: AuthedRequest, res) => {
    res
      .status(201)
      .json(await svc.addMarketPrice(req, req.params.id, req.body as z.infer<typeof addMarketPriceSchema>));
  }),
);
