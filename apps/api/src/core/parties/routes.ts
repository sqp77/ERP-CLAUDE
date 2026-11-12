import { Router } from 'express';
import { z } from 'zod';
import { arabicSearchRegex, paginationSchema } from '@eayni/shared';
import { asyncHandler } from '../http/async';
import { validate } from '../http/validate';
import { notFound } from '../http/errors';
import { requireAuth } from '../auth/middleware';
import { authorize } from '../rbac/authorize';
import { Party } from './model';

/** Read side of the party master [FIN §8]; Finance edits tax and bank data when its module arrives. */
export const partiesRouter = Router();
const listQuery = paginationSchema.extend({
  q: z.string().trim().max(120).optional(),
  role: z.enum(['customer', 'supplier']).optional(),
});

partiesRouter.get(
  '/',
  requireAuth(),
  authorize('parties', 'view'),
  validate(listQuery, 'query'),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as z.infer<typeof listQuery>;
    const filter: Record<string, unknown> = { deletedAt: null };
    if (q.role) filter.roles = q.role;
    if (q.q)
      filter.$or = [
        { legalNameAr: arabicSearchRegex(q.q) },
        { crNumber: q.q },
        { unifiedNumber: q.q },
        { vatNumber: q.q },
      ];
    const [items, total] = await Promise.all([
      Party.find(filter)
        .sort({ legalNameAr: 1 })
        .skip((q.page - 1) * q.limit)
        .limit(q.limit)
        .lean(),
      Party.countDocuments(filter),
    ]);
    res.json({ items, total, page: q.page, limit: q.limit });
  }),
);

partiesRouter.get(
  '/:id',
  requireAuth(),
  authorize('parties', 'view'),
  asyncHandler(async (req, res) => {
    const p = await Party.findOne({ _id: req.params.id, deletedAt: null }).lean();
    if (!p) throw notFound();
    res.json(p);
  }),
);
