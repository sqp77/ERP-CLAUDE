import { Router, type RequestHandler } from 'express';
import type { Model } from 'mongoose';
import type { ZodTypeAny } from 'zod';
import {
  branchSchema,
  branchUpdateSchema,
  departmentSchema,
  departmentUpdateSchema,
  positionSchema,
  positionUpdateSchema,
  siteSchema,
  siteUpdateSchema,
  unitSchema,
  unitUpdateSchema,
} from '@eayni/shared';
import { asyncHandler } from '../http/async';
import { validate } from '../http/validate';
import { actorFrom, type AuthedRequest } from '../http/context';
import { notFound } from '../http/errors';
import { requireAuth } from '../auth/middleware';
import { authorize } from '../rbac/authorize';
import { recordAudit } from '../audit/service';
import { Branch, Department, Position, Site, Unit } from './model';

/**
 * Generic soft-deleting CRUD for simple master-data collections. Every write is audited.
 * Business records use soft delete only (golden rule 3).
 */
function crud(
  router: Router,
  path: string,
  resource: string,
  Model: Model<any>, // eslint-disable-line @typescript-eslint/no-explicit-any
  createSchema: ZodTypeAny,
  updateSchema: ZodTypeAny,
  transform: (body: Record<string, unknown>) => Record<string, unknown> = (b) => b,
  sort: Record<string, 1 | -1> = { nameAr: 1 },
) {
  const list: RequestHandler = asyncHandler(async (req, res) => {
    const includeInactive = req.query.all === 'true';
    const filter: Record<string, unknown> = { deletedAt: null };
    if (!includeInactive) filter.active = true;
    for (const k of ['departmentId', 'branchId']) if (typeof req.query[k] === 'string') filter[k] = req.query[k];
    res.json({ items: await Model.find(filter).sort(sort).lean() });
  });
  const getOne: RequestHandler = asyncHandler(async (req, res) => {
    const doc = await Model.findOne({ _id: req.params.id, deletedAt: null }).lean();
    if (!doc) throw notFound();
    res.json(doc);
  });
  const create: RequestHandler = asyncHandler(async (req: AuthedRequest, res) => {
    const doc = await Model.create(transform(req.body));
    await recordAudit(actorFrom(req), { action: 'create', resource, resourceId: String(doc._id), after: doc });
    res.status(201).json(doc);
  });
  const update: RequestHandler = asyncHandler(async (req: AuthedRequest, res) => {
    const before = await Model.findOne({ _id: req.params.id, deletedAt: null }).lean();
    if (!before) throw notFound();
    const doc = await Model.findByIdAndUpdate(req.params.id, { $set: transform(req.body) }, { new: true }).lean();
    await recordAudit(actorFrom(req), { action: 'update', resource, resourceId: req.params.id, before, after: doc });
    res.json(doc);
  });
  const remove: RequestHandler = asyncHandler(async (req: AuthedRequest, res) => {
    const before = await Model.findOne({ _id: req.params.id, deletedAt: null }).lean();
    if (!before) throw notFound();
    await Model.updateOne({ _id: req.params.id }, { $set: { deletedAt: new Date(), active: false } });
    await recordAudit(actorFrom(req), { action: 'delete', resource, resourceId: req.params.id, before });
    res.status(204).end();
  });

  router.get(path, requireAuth(), authorize(resource, 'view'), list);
  router.get(`${path}/:id`, requireAuth(), authorize(resource, 'view'), getOne);
  router.post(path, requireAuth(), authorize(resource, 'create'), validate(createSchema), create);
  router.patch(`${path}/:id`, requireAuth(), authorize(resource, 'edit'), validate(updateSchema), update);
  router.delete(`${path}/:id`, requireAuth(), authorize(resource, 'delete'), remove);
}

const siteTransform = (b: Record<string, unknown>) => {
  const out = { ...b };
  const loc = b.location as { lat: number; lng: number } | null | undefined;
  if (loc) out.location = { type: 'Point', coordinates: [loc.lng, loc.lat] };
  else if (loc === null) out.location = undefined;
  return out;
};

export const orgRouter = Router();
crud(orgRouter, '/departments', 'org.departments', Department, departmentSchema, departmentUpdateSchema, (b) => b, { code: 1 });
crud(orgRouter, '/units', 'org.units', Unit, unitSchema, unitUpdateSchema);
crud(orgRouter, '/branches', 'org.branches', Branch, branchSchema, branchUpdateSchema, (b) => b, { code: 1 });
crud(orgRouter, '/sites', 'org.sites', Site, siteSchema, siteUpdateSchema, siteTransform);
crud(orgRouter, '/positions', 'org.positions', Position, positionSchema, positionUpdateSchema, (b) => b, { code: 1 });
