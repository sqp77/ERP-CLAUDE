import { Router } from 'express';
import type { z } from 'zod';
import { listInvoicesQuerySchema, recordPaymentSchema, registerInvoiceSchema } from '@eayni/shared';
import { asyncHandler } from '../../core/http/async';
import { validate } from '../../core/http/validate';
import type { AuthedRequest } from '../../core/http/context';
import { requireAuth } from '../../core/auth/middleware';
import { authorize } from '../../core/rbac/authorize';
import { sendHtml } from '../../core/templates/render';
import * as svc from './invoices.service';

/** Invoice register [SAL §7.3, FIN §7]: Finance writes, Sales reads (own / department), the executive reads all. */
export const invoicesRouter = Router();

invoicesRouter.post(
  '/',
  requireAuth(),
  authorize('finance.invoices', 'create'),
  validate(registerInvoiceSchema),
  asyncHandler(async (req: AuthedRequest, res) => {
    res.status(201).json(await svc.registerInvoice(req, req.body as z.infer<typeof registerInvoiceSchema>));
  }),
);
invoicesRouter.get(
  '/',
  requireAuth(),
  authorize('finance.invoices', 'view'),
  validate(listInvoicesQuerySchema, 'query'),
  asyncHandler(async (req: AuthedRequest, res) => {
    res.json(await svc.listInvoices(req, req.query as unknown as svc.ListInvoicesQuery));
  }),
);
invoicesRouter.get(
  '/:id',
  requireAuth(),
  authorize('finance.invoices', 'view'),
  asyncHandler(async (req: AuthedRequest, res) => {
    res.json(await svc.getInvoice(req, req.params.id));
  }),
);
invoicesRouter.get(
  '/:id/document',
  requireAuth(),
  authorize('finance.invoices', 'view'),
  asyncHandler(async (req: AuthedRequest, res) => {
    sendHtml(res, await svc.invoiceDocument(req, req.params.id));
  }),
);
invoicesRouter.post(
  '/:id/payments',
  requireAuth(),
  authorize('finance.invoices', 'edit'),
  validate(recordPaymentSchema),
  asyncHandler(async (req: AuthedRequest, res) => {
    res.json(await svc.recordPayment(req, req.params.id, req.body as z.infer<typeof recordPaymentSchema>));
  }),
);
