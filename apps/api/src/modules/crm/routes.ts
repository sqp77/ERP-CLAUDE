import { Router } from 'express';
import type { z } from 'zod';
import {
  CUSTOMER_CLASSIFICATIONS,
  CUSTOMER_SOURCES,
  CUSTOMER_STATUSES,
  COMMUNICATION_METHODS,
  LEAD_STATES,
  assignLeadSchema,
  contactInputSchema,
  convertLeadSchema,
  createCommunicationLogSchema,
  createCustomerSchema,
  createLeadSchema,
  duplicateCheckSchema,
  leadStateSchema,
  listCustomersQuerySchema,
  listLeadsQuerySchema,
  transferCustomersSchema,
  updateCustomerSchema,
  type CreateCommunicationLogInput,
  type CreateCustomerInput,
  type CreateLeadInput,
  type TransferCustomersInput,
  type UpdateCustomerInput,
} from '@eayni/shared';
import { asyncHandler } from '../../core/http/async';
import { validate } from '../../core/http/validate';
import type { AuthedRequest } from '../../core/http/context';
import { requireAuth } from '../../core/auth/middleware';
import { authorize } from '../../core/rbac/authorize';
import { getSetting } from '../../core/settings/service';
import { searchPeople } from '../../core/records/resolvers';
import * as svc from './service';

export const crmRouter = Router();

/** Lists and labels the CRM forms need (configurable ones from settings) [SAL §4.1, DECISIONS §20 Q7/Q8]. */
crmRouter.get(
  '/meta',
  requireAuth(),
  asyncHandler(async (req: AuthedRequest, res) => {
    const [organizationTypes, facilitySizes, lossReasons, registrationHours] = await Promise.all([
      getSetting('crm.organizationTypes'),
      getSetting('sales.facilitySizes'),
      getSetting('sales.lossReasons'),
      getSetting('crm.leadRegistrationHours'),
    ]);
    res.json({
      organizationTypes,
      facilitySizes,
      lossReasons,
      registrationHours,
      statuses: CUSTOMER_STATUSES,
      sources: CUSTOMER_SOURCES,
      classifications: CUSTOMER_CLASSIFICATIONS,
      methods: COMMUNICATION_METHODS,
      leadStates: LEAD_STATES,
      canReferLeads: await svc.canReferLeads(req),
    });
  }),
);

/** Sales department people, for owner / assignee pickers [SAL §8.1]. */
crmRouter.get(
  '/sales-team',
  requireAuth(),
  authorize('crm.customers', 'view'),
  asyncHandler(async (_req, res) => {
    const salesId = await svc.salesDepartmentId();
    const people = (await searchPeople('', 500)).filter((p) => p.departmentId === salesId);
    res.json({ items: people });
  }),
);

// ---- customers -----------------------------------------------------------------------------------
crmRouter.post(
  '/customers/check-duplicate',
  requireAuth(),
  authorize('crm.customers', 'view'),
  validate(duplicateCheckSchema),
  asyncHandler(async (req: AuthedRequest, res) => {
    res.json(await svc.checkDuplicate(req, req.body as z.infer<typeof duplicateCheckSchema>));
  }),
);
crmRouter.post(
  '/customers',
  requireAuth(),
  authorize('crm.customers', 'create'),
  validate(createCustomerSchema),
  asyncHandler(async (req: AuthedRequest, res) => {
    res.status(201).json(await svc.createCustomer(req, req.body as CreateCustomerInput));
  }),
);
crmRouter.get(
  '/customers',
  requireAuth(),
  authorize('crm.customers', 'view'),
  validate(listCustomersQuerySchema, 'query'),
  asyncHandler(async (req: AuthedRequest, res) => {
    res.json(await svc.listCustomers(req, req.query as unknown as svc.ListCustomersQuery));
  }),
);
crmRouter.post(
  '/customers/transfer',
  requireAuth(),
  authorize('crm.customers', 'approve'),
  validate(transferCustomersSchema),
  asyncHandler(async (req: AuthedRequest, res) => {
    res.json(await svc.transferCustomers(req, req.body as TransferCustomersInput));
  }),
);
crmRouter.get(
  '/customers/:id',
  requireAuth(),
  authorize('crm.customers', 'view'),
  asyncHandler(async (req: AuthedRequest, res) => {
    res.json(await svc.getCustomer(req, req.params.id));
  }),
);
crmRouter.patch(
  '/customers/:id',
  requireAuth(),
  authorize('crm.customers', 'edit'),
  validate(updateCustomerSchema),
  asyncHandler(async (req: AuthedRequest, res) => {
    res.json(await svc.updateCustomer(req, req.params.id, req.body as UpdateCustomerInput));
  }),
);
crmRouter.post(
  '/customers/:id/contacts',
  requireAuth(),
  authorize('crm.customers', 'edit'),
  validate(contactInputSchema),
  asyncHandler(async (req: AuthedRequest, res) => {
    res.status(201).json(await svc.addContact(req, req.params.id, req.body));
  }),
);
crmRouter.patch(
  '/customers/:id/contacts/:contactId',
  requireAuth(),
  authorize('crm.customers', 'edit'),
  validate(contactInputSchema.partial()),
  asyncHandler(async (req: AuthedRequest, res) => {
    res.json(await svc.updateContact(req, req.params.id, req.params.contactId, req.body));
  }),
);
crmRouter.delete(
  '/customers/:id/contacts/:contactId',
  requireAuth(),
  authorize('crm.customers', 'edit'),
  asyncHandler(async (req: AuthedRequest, res) => {
    await svc.removeContact(req, req.params.id, req.params.contactId);
    res.status(204).end();
  }),
);
/** سجل التواصل: GET in chronological order, POST appends. There is deliberately no PATCH or DELETE [SAL §4.1, §19]. */
crmRouter.get(
  '/customers/:id/logs',
  requireAuth(),
  authorize('crm.customers', 'view'),
  asyncHandler(async (req: AuthedRequest, res) => {
    res.json({ items: await svc.listLogs(req, req.params.id) });
  }),
);
crmRouter.post(
  '/customers/:id/logs',
  requireAuth(),
  authorize('crm.customers', 'view'),
  validate(createCommunicationLogSchema),
  asyncHandler(async (req: AuthedRequest, res) => {
    res.status(201).json(await svc.addLog(req, req.params.id, req.body as CreateCommunicationLogInput));
  }),
);

// ---- leads ---------------------------------------------------------------------------------------
/** «إحالة عميل محتمل إلى المبيعات» — Customer Service users (department code `cs`) or a `crm.leads:create` grant. */
crmRouter.post(
  '/leads',
  requireAuth(),
  validate(createLeadSchema),
  asyncHandler(async (req: AuthedRequest, res) => {
    res.status(201).json(await svc.createLead(req, req.body as CreateLeadInput));
  }),
);
crmRouter.get(
  '/leads',
  requireAuth(),
  validate(listLeadsQuerySchema, 'query'),
  asyncHandler(async (req: AuthedRequest, res) => {
    res.json(await svc.listLeads(req, req.query as unknown as svc.ListLeadsQuery));
  }),
);
crmRouter.get(
  '/leads/:id',
  requireAuth(),
  asyncHandler(async (req: AuthedRequest, res) => {
    res.json(await svc.getLead(req, req.params.id));
  }),
);
crmRouter.post(
  '/leads/:id/assign',
  requireAuth(),
  authorize('crm.leads', 'approve'),
  validate(assignLeadSchema),
  asyncHandler(async (req: AuthedRequest, res) => {
    res.json(
      await svc.assignLead(req, req.params.id, (req.body as { assigneeUserId: string }).assigneeUserId),
    );
  }),
);
crmRouter.post(
  '/leads/:id/state',
  requireAuth(),
  authorize('crm.leads', 'edit'),
  validate(leadStateSchema),
  asyncHandler(async (req: AuthedRequest, res) => {
    res.json(await svc.setLeadState(req, req.params.id, req.body as z.infer<typeof leadStateSchema>));
  }),
);
crmRouter.post(
  '/leads/:id/convert',
  requireAuth(),
  authorize('crm.leads', 'edit'),
  validate(convertLeadSchema),
  asyncHandler(async (req: AuthedRequest, res) => {
    res.json(await svc.convertLead(req, req.params.id, req.body as z.infer<typeof convertLeadSchema>));
  }),
);
