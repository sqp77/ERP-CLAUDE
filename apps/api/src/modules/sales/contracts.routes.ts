import { Router } from 'express';
import { z } from 'zod';
import {
  certificateSendSchema,
  createContractSchema,
  listContractsQuerySchema,
  scheduleEntrySchema,
  scheduleStatusSchema,
  updateContractSchema,
} from '@eayni/shared';
import { asyncHandler } from '../../core/http/async';
import { validate } from '../../core/http/validate';
import type { AuthedRequest } from '../../core/http/context';
import { requireAuth } from '../../core/auth/middleware';
import { authorize } from '../../core/rbac/authorize';
import * as svc from './contracts.service';

/** العقود الدورية وشهادات التعاون [SAL §6.3, §7.4]. */
export const contractsRouter = Router();

contractsRouter.post(
  '/',
  requireAuth(),
  authorize('sales.contracts', 'create'),
  validate(createContractSchema),
  asyncHandler(async (req: AuthedRequest, res) => {
    res.status(201).json(await svc.createContract(req, req.body as z.infer<typeof createContractSchema>));
  }),
);
contractsRouter.get(
  '/',
  requireAuth(),
  authorize('sales.contracts', 'view'),
  validate(listContractsQuerySchema, 'query'),
  asyncHandler(async (req: AuthedRequest, res) => {
    res.json(await svc.listContracts(req, req.query as unknown as svc.ListContractsQuery));
  }),
);
contractsRouter.get(
  '/:id',
  requireAuth(),
  authorize('sales.contracts', 'view'),
  asyncHandler(async (req: AuthedRequest, res) => {
    res.json(await svc.getContract(req, req.params.id));
  }),
);
contractsRouter.patch(
  '/:id',
  requireAuth(),
  authorize('sales.contracts', 'edit'),
  validate(updateContractSchema),
  asyncHandler(async (req: AuthedRequest, res) => {
    res.json(await svc.updateContract(req, req.params.id, req.body as z.infer<typeof updateContractSchema>));
  }),
);
contractsRouter.post(
  '/:id/schedule',
  requireAuth(),
  authorize('sales.contracts', 'edit'),
  validate(scheduleEntrySchema),
  asyncHandler(async (req: AuthedRequest, res) => {
    res.json(await svc.addScheduleEntry(req, req.params.id, req.body as z.infer<typeof scheduleEntrySchema>));
  }),
);
contractsRouter.post(
  '/:id/schedule/:entryId/status',
  requireAuth(),
  authorize('sales.contracts', 'edit'),
  validate(scheduleStatusSchema),
  asyncHandler(async (req: AuthedRequest, res) => {
    res.json(
      await svc.setScheduleStatus(
        req,
        req.params.id,
        req.params.entryId,
        req.body as z.infer<typeof scheduleStatusSchema>,
      ),
    );
  }),
);
contractsRouter.post(
  '/:id/renew',
  requireAuth(),
  authorize('sales.contracts', 'create'),
  validate(createContractSchema.omit({ customerId: true, renewalOf: true })),
  asyncHandler(async (req: AuthedRequest, res) => {
    const prev = await svc.getContract(req, req.params.id);
    res
      .status(201)
      .json(
        await svc.createContract(req, {
          ...(req.body as z.infer<typeof createContractSchema>),
          customerId: String(prev.customerId),
          renewalOf: req.params.id,
        }),
      );
  }),
);
contractsRouter.post(
  '/:id/terminate',
  requireAuth(),
  authorize('sales.contracts', 'edit'),
  validate(z.object({ reason: z.string().trim().min(2).max(500) })),
  asyncHandler(async (req: AuthedRequest, res) => {
    res.json(await svc.terminateContract(req, req.params.id, (req.body as { reason: string }).reason));
  }),
);
contractsRouter.post(
  '/:id/certificates',
  requireAuth(),
  authorize('sales.contracts', 'edit'),
  asyncHandler(async (req: AuthedRequest, res) => {
    res.status(201).json(await svc.issueCertificate(req, req.params.id));
  }),
);
contractsRouter.post(
  '/:id/certificates/:certId/send',
  requireAuth(),
  authorize('sales.contracts', 'edit'),
  validate(certificateSendSchema),
  asyncHandler(async (req: AuthedRequest, res) => {
    res.json(
      await svc.sendCertificate(
        req,
        req.params.id,
        req.params.certId,
        req.body as z.infer<typeof certificateSendSchema>,
      ),
    );
  }),
);
