import { Router } from 'express';
import type { z } from 'zod';
import {
  createTicketSchema,
  listTicketsQuerySchema,
  OPEN_TICKET_STATES,
  ticketTransitionSchema,
  type CreateTicketInput,
} from '@eayni/shared';
import { asyncHandler } from '../../core/http/async';
import { validate } from '../../core/http/validate';
import { actorFrom, type AuthedRequest } from '../../core/http/context';
import { forbidden } from '../../core/http/errors';
import { requireAuth } from '../../core/auth/middleware';
import { authorize } from '../../core/rbac/authorize';
import { Attachment } from '../../core/files/model';
import { User } from '../../core/auth/model';
import { Department } from '../../core/org/model';
import { effectivePermission } from '../../core/rbac/service';
import type { RoleAssignment } from '@eayni/shared';
import { Ticket } from './model';
import * as svc from './service';

export const ticketsRouter = Router();

/** Departments I may address, with their configured fields [EP §9.1, IT §7.1]. */
ticketsRouter.get(
  '/targets',
  requireAuth(),
  asyncHandler(async (req: AuthedRequest, res) => {
    const dept = await svc.departmentOf(req.auth.user);
    const scope =
      (
        await effectivePermission(
          req.auth.user.roles as RoleAssignment[],
          dept?.id,
          'tickets',
          'view',
          String(req.auth.user._id),
        )
      )?.scope ?? 'own';
    res.json({
      items: await svc.targetsFor(req.auth.user),
      queue: {
        departmentCode: dept?.code ?? null,
        isManager: scope === 'department' || scope === 'all',
        canView: scope !== 'own' || (!!dept && (await svc.staffQueueEnabled(dept.code))),
      },
    });
  }),
);

ticketsRouter.post(
  '/',
  requireAuth(),
  authorize('tickets', 'create'),
  validate(createTicketSchema),
  asyncHandler(async (req: AuthedRequest, res) => {
    res.status(201).json(await svc.createTicket(req, req.body as CreateTicketInput));
  }),
);

ticketsRouter.get(
  '/',
  requireAuth(),
  authorize('tickets', 'view'),
  validate(listTicketsQuerySchema, 'query'),
  asyncHandler(async (req: AuthedRequest, res) => {
    const q = req.query as unknown as z.infer<typeof listTicketsQuerySchema>;
    const user = req.auth.user;
    // 'team' uses exactly the dashboard's filter (follow-up 5); the other views intersect with the caller's visibility.
    const filter: Record<string, unknown> =
      q.view === 'team'
        ? await svc.teamTicketsFilter(String(user._id))
        : { deletedAt: null, ...(await svc.visibilityFilter(user, req.authz!)) };
    if (q.view === 'mine') filter.requesterUserId = user._id;
    if (q.view === 'assigned') filter.assigneeId = user._id;
    if (q.view === 'department') {
      if (req.authz!.scope === 'department') filter.departmentId = { $in: req.authz!.departmentIds };
      else if (req.authz!.scope !== 'all') {
        const dept = await svc.departmentOf(user);
        if (!dept || !(await svc.staffQueueEnabled(dept.code)))
          throw forbidden('قائمة تذاكر القسم غير متاحة لك');
        filter.departmentId = dept.id;
      }
    }
    if (q.state) filter.state = q.state;
    if (q.open) filter.state = { $in: [...OPEN_TICKET_STATES] };
    if (q.departmentCode) filter.departmentCode = q.departmentCode;
    if (q.type) filter.type = q.type;
    if (q.priority) filter.priority = q.priority;
    if (q.assigneeId) filter.assigneeId = q.assigneeId;
    if (q.unassigned) filter.assigneeId = null;
    const [items, total] = await Promise.all([
      Ticket.find(filter)
        .sort({ lastActivityAt: -1 })
        .skip((q.page - 1) * q.limit)
        .limit(q.limit)
        .lean(),
      Ticket.countDocuments(filter),
    ]);
    const userIds = [
      ...new Set(
        items
          .flatMap((i) => [i.assigneeId, i.requesterUserId])
          .filter(Boolean)
          .map(String),
      ),
    ];
    const users = await User.find({ _id: { $in: userIds } })
      .select('displayNameAr')
      .lean();
    const names = new Map(users.map((u) => [String(u._id), u.displayNameAr]));
    res.json({
      items: items.map((i) => ({
        ...i,
        assigneeName: i.assigneeId ? names.get(String(i.assigneeId)) : undefined,
        requesterName: i.requester?.fullNameAr ?? names.get(String(i.requesterUserId)),
      })),
      total,
      page: q.page,
      limit: q.limit,
    });
  }),
);

ticketsRouter.get(
  '/:id',
  requireAuth(),
  authorize('tickets', 'view'),
  asyncHandler(async (req: AuthedRequest, res) => {
    const t = await svc.findVisible(req, req.params.id);
    const [actions, hist, attachments, assignee, dept, config] = await Promise.all([
      svc.availableActions(req.auth.user, t),
      svc.history(String(t._id)),
      Attachment.find({ _id: { $in: t.attachmentIds } })
        .select('originalName mimeType size')
        .lean(),
      t.assigneeId ? User.findById(t.assigneeId).select('displayNameAr').lean() : null,
      Department.findById(t.departmentId).select('nameAr code').lean(),
      svc.targetsFor(req.auth.user).then((ts) => ts.find((x) => x.code === t.departmentCode)?.config),
    ]);
    const { getSetting } = await import('../../core/settings/service');
    const allConfig = await getSetting('tickets.departmentFields');
    res.json({
      ...t.toObject(),
      actions,
      history: hist,
      attachments,
      assigneeName: assignee?.displayNameAr,
      department: dept,
      departmentConfig: config ?? allConfig[t.departmentCode] ?? { fields: [] },
      reopenWithinDays: await getSetting('tickets.reopenWithinDays'),
    });
  }),
);

ticketsRouter.post(
  '/:id/transition',
  requireAuth(),
  authorize('tickets', 'view'),
  validate(ticketTransitionSchema),
  asyncHandler(async (req: AuthedRequest, res) => {
    const t = await svc.findVisible(req, req.params.id);
    const { transition: code, ...input } = req.body as z.infer<typeof ticketTransitionSchema>;
    const updated =
      code === 'assign'
        ? await svc.assignByManager(req, t, input.assigneeId ?? '', input.note)
        : await svc.transition(t, code, {
            user: req.auth.user,
            actor: actorFrom(req),
            relations: await svc.relationsFor(req.auth.user, t),
            input,
          });
    res.json({ ...updated.toObject(), actions: await svc.availableActions(req.auth.user, updated) });
  }),
);
