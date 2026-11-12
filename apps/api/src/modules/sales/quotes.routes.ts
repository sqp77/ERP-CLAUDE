import { Router } from 'express';
import { z } from 'zod';
import {
  createQuoteSchema,
  listQuotesQuerySchema,
  quoteDecisionSchema,
  quoteResponseSchema,
  quoteSendSchema,
  updateQuoteSchema,
  type CreateQuoteInput,
} from '@eayni/shared';
import { asyncHandler } from '../../core/http/async';
import { validate } from '../../core/http/validate';
import type { AuthedRequest } from '../../core/http/context';
import { requireAuth } from '../../core/auth/middleware';
import { authorize } from '../../core/rbac/authorize';
import { sendHtml } from '../../core/templates/render';
import { markSentExternally } from '../../core/email/service';
import { forbidden } from '../../core/http/errors';
import * as svc from './quotes.service';

/** عروض الأسعار [SAL §3 م2–م3, §7.2, §7.3] and sales orders [§3 م4]. */
export const quotesRouter = Router();

quotesRouter.post(
  '/',
  requireAuth(),
  authorize('sales.quotes', 'create'),
  validate(createQuoteSchema),
  asyncHandler(async (req: AuthedRequest, res) => {
    res.status(201).json(await svc.createQuote(req, req.body as CreateQuoteInput));
  }),
);
quotesRouter.get(
  '/',
  requireAuth(),
  authorize('sales.quotes', 'view'),
  validate(listQuotesQuerySchema, 'query'),
  asyncHandler(async (req: AuthedRequest, res) => {
    res.json(await svc.listQuotes(req, req.query as unknown as svc.ListQuotesQuery));
  }),
);
/** Preview of the lines and totals the server would compute (builder) — no record is written. */
quotesRouter.post(
  '/preview',
  requireAuth(),
  authorize('sales.quotes', 'create'),
  validate(z.object({ lines: createQuoteSchema.shape.lines })),
  asyncHandler(async (req: AuthedRequest, res) => {
    const computed = await svc.computeLines((req.body as { lines: CreateQuoteInput['lines'] }).lines);
    res.json({ ...computed, approval: await svc.approvalLevelFor(computed.maxDiscountBp) });
  }),
);
quotesRouter.get(
  '/orders/:id',
  requireAuth(),
  asyncHandler(async (req: AuthedRequest, res) => {
    res.json(await svc.getSalesOrder(req, req.params.id));
  }),
);
quotesRouter.get(
  '/:id',
  requireAuth(),
  authorize('sales.quotes', 'view'),
  asyncHandler(async (req: AuthedRequest, res) => {
    res.json(await svc.getQuote(req, req.params.id));
  }),
);
quotesRouter.get(
  '/:id/document',
  requireAuth(),
  authorize('sales.quotes', 'view'),
  asyncHandler(async (req: AuthedRequest, res) => {
    sendHtml(res, await svc.customerDocument(req, req.params.id));
  }),
);
quotesRouter.patch(
  '/:id',
  requireAuth(),
  authorize('sales.quotes', 'edit'),
  validate(updateQuoteSchema),
  asyncHandler(async (req: AuthedRequest, res) => {
    res.json(await svc.updateQuote(req, req.params.id, req.body as Partial<CreateQuoteInput>));
  }),
);
quotesRouter.post(
  '/:id/submit',
  requireAuth(),
  authorize('sales.quotes', 'edit'),
  asyncHandler(async (req: AuthedRequest, res) => {
    res.json(await svc.submitQuote(req, req.params.id));
  }),
);
quotesRouter.post(
  '/:id/approve',
  requireAuth(),
  authorize('sales.quotes', 'approve'),
  validate(quoteDecisionSchema),
  asyncHandler(async (req: AuthedRequest, res) => {
    res.json(await svc.decideQuote(req, req.params.id, 'approve', (req.body as { note?: string }).note));
  }),
);
quotesRouter.post(
  '/:id/reject-approval',
  requireAuth(),
  authorize('sales.quotes', 'approve'),
  validate(quoteDecisionSchema),
  asyncHandler(async (req: AuthedRequest, res) => {
    res.json(await svc.decideQuote(req, req.params.id, 'reject', (req.body as { note?: string }).note));
  }),
);
quotesRouter.post(
  '/:id/send',
  requireAuth(),
  authorize('sales.quotes', 'edit'),
  validate(quoteSendSchema),
  asyncHandler(async (req: AuthedRequest, res) => {
    res.json(await svc.sendQuote(req, req.params.id, req.body as z.infer<typeof quoteSendSchema>));
  }),
);
quotesRouter.post(
  '/:id/respond',
  requireAuth(),
  authorize('sales.quotes', 'edit'),
  validate(quoteResponseSchema),
  asyncHandler(async (req: AuthedRequest, res) => {
    res.json(await svc.respondQuote(req, req.params.id, req.body as z.infer<typeof quoteResponseSchema>));
  }),
);
quotesRouter.post(
  '/:id/revise',
  requireAuth(),
  authorize('sales.quotes', 'create'),
  asyncHandler(async (req: AuthedRequest, res) => {
    res.status(201).json(await svc.reviseQuote(req, req.params.id));
  }),
);
quotesRouter.post(
  '/:id/cancel',
  requireAuth(),
  authorize('sales.quotes', 'edit'),
  validate(z.object({ reason: z.string().trim().min(2).max(500) })),
  asyncHandler(async (req: AuthedRequest, res) => {
    res.json(await svc.cancelQuote(req, req.params.id, (req.body as { reason: string }).reason));
  }),
);
/** The employee sent the composed message from their own mail client (mailbox adapter disabled, Q5). */
quotesRouter.post(
  '/emails/:messageId/sent-externally',
  requireAuth(),
  asyncHandler(async (req: AuthedRequest, res) => {
    if (!(await markSentExternally(req.params.messageId, String(req.auth.user._id))))
      throw forbidden('الرسالة ليست مسوّدتك أو سبق تسجيلها');
    res.json({ ok: true });
  }),
);
