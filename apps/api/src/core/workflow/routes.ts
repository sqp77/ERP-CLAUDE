import { Router } from 'express';
import { workflowDefinitionSchema } from '@eayni/shared';
import { asyncHandler } from '../http/async';
import { validate } from '../http/validate';
import { actorFrom, type AuthedRequest } from '../http/context';
import { notFound } from '../http/errors';
import { requireAuth } from '../auth/middleware';
import { authorize } from '../rbac/authorize';
import { recordAudit } from '../audit/service';
import { saveWorkflow, stageHistory } from './engine';
import { WorkflowDef } from './model';

export const workflowsRouter = Router();

workflowsRouter.get(
  '/',
  requireAuth(),
  authorize('workflows', 'view'),
  asyncHandler(async (_req, res) => {
    res.json({ items: await WorkflowDef.find().sort({ type: 1 }).lean() });
  }),
);

workflowsRouter.get(
  '/:type',
  requireAuth(),
  authorize('workflows', 'view'),
  asyncHandler(async (req, res) => {
    const doc = await WorkflowDef.findOne({ type: req.params.type }).lean();
    if (!doc) throw notFound();
    res.json(doc);
  }),
);

workflowsRouter.put(
  '/:type',
  requireAuth(),
  authorize('workflows', 'edit'),
  validate(workflowDefinitionSchema),
  asyncHandler(async (req: AuthedRequest, res) => {
    const before = await WorkflowDef.findOne({ type: req.params.type }).lean();
    const def = await saveWorkflow(
      { ...req.body, type: req.params.type, version: (before?.version ?? 0) + 1 },
      String(req.auth.user._id),
    );
    await recordAudit(actorFrom(req), {
      action: before ? 'update' : 'create',
      resource: 'workflows',
      resourceId: req.params.type,
      before,
      after: def,
    });
    res.json(def);
  }),
);

/** Stage history of any workflow record (who moved it, when, how long, late or not). */
workflowsRouter.get(
  '/history/:recordType/:recordId',
  requireAuth(),
  asyncHandler(async (req, res) => {
    res.json({ items: await stageHistory(req.params.recordType, req.params.recordId) });
  }),
);
