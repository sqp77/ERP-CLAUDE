import { Router } from 'express';
import type { RoleAssignment } from '@eayni/shared';
import { OPEN_TASK_STATUSES, OPEN_TICKET_STATES } from '@eayni/shared';
import { asyncHandler } from '../../core/http/async';
import { startOfRiyadhWeek } from '../../core/dates/businessDays';
import type { AuthedRequest } from '../../core/http/context';
import { badRequest, forbidden } from '../../core/http/errors';
import { requireAuth } from '../../core/auth/middleware';
import { authorize } from '../../core/rbac/authorize';
import { effectivePermission } from '../../core/rbac/service';
import { Task } from '../../core/tasks/model';
import { CalendarEvent } from '../../core/calendar/model';
import { DocumentRecord } from '../../core/documents/model';
import { Department, Branch } from '../../core/org/model';
import { Ticket } from '../tickets/model';
import { Contract, Employee, EmployeeEvent } from './model';
import { HrRequest } from './requests.model';
import { EmployeeReport } from './reports.model';

export const dashboardRouter = Router();
const DAY = 86_400_000;

/**
 * Direct-manager dashboard [EP §16]: my team (direct reports, plus the department for a department manager),
 * their tasks by status and overdue, requests waiting on me, reports awaiting review, team meetings this week.
 */
dashboardRouter.get(
  '/manager',
  requireAuth(),
  asyncHandler(async (req: AuthedRequest, res) => {
    const user = req.auth.user;
    const me = await Employee.findOne({ userId: user._id, deletedAt: null }).select('_id').lean();
    const eff = await effectivePermission(
      user.roles as RoleAssignment[],
      user.departmentId ? String(user.departmentId) : undefined,
      'hr.employees',
      'view',
      String(user._id),
    );
    const or: Record<string, unknown>[] = [];
    if (me) or.push({ directManagerId: me._id });
    if (eff?.scope === 'department' && eff.departmentIds.length)
      or.push({ departmentId: { $in: eff.departmentIds } });
    if (!or.length) throw forbidden('هذه اللوحة للمديرين المباشرين ومديري الأقسام');
    const team = await Employee.find({ $or: or, deletedAt: null, _id: { $ne: me?._id } })
      .select('status userId secondment')
      .lean();
    if (!team.length && eff?.scope !== 'department')
      throw forbidden('هذه اللوحة للمديرين المباشرين ومديري الأقسام');
    const userIds = team.map((t) => t.userId).filter(Boolean);
    const now = new Date();
    const weekStart = startOfRiyadhWeek(now); // review G11: shared Riyadh helper
    const weekEnd = new Date(weekStart.getTime() + 7 * DAY);
    const [tasks, requestsPending, reportsPending, meetings, tickets] = await Promise.all([
      Task.find({ assigneeId: { $in: userIds }, deletedAt: null })
        .select('status dueAt')
        .lean(),
      HrRequest.countDocuments({ directManagerUserId: user._id, state: 'awaiting_manager', deletedAt: null }),
      EmployeeReport.countDocuments({ userId: { $in: userIds }, state: 'submitted', deletedAt: null }),
      CalendarEvent.countDocuments({
        deletedAt: null,
        status: { $in: ['scheduled', 'rescheduled'] },
        startAt: { $gte: weekStart, $lt: weekEnd },
        $or: [{ ownerId: user._id }, { participantIds: { $in: [user._id, ...userIds] } }],
      }),
      Ticket.countDocuments({
        assigneeId: { $in: userIds },
        state: { $in: [...OPEN_TICKET_STATES] },
        deletedAt: null,
      }),
    ]);
    const byStatus: Record<string, number> = {};
    let overdue = 0;
    for (const t of tasks) {
      byStatus[t.status] = (byStatus[t.status] ?? 0) + 1;
      if ((OPEN_TASK_STATUSES as readonly string[]).includes(t.status) && t.dueAt && t.dueAt < now) overdue++;
    }
    res.json({
      team: {
        total: team.length,
        active: team.filter((t) => t.status === 'active' || t.status === 'field_work').length,
        onLeave: team.filter((t) => t.status === 'on_leave').length,
        seconded: team.filter((t) => t.status === 'seconded').length,
        other: team.filter((t) => !['active', 'field_work', 'on_leave', 'seconded'].includes(t.status))
          .length,
      },
      tasks: {
        byStatus,
        overdue,
        open: tasks.filter((t) => (OPEN_TASK_STATUSES as readonly string[]).includes(t.status)).length,
      },
      tickets: { open: tickets },
      requestsPending,
      reportsPending,
      meetingsThisWeek: meetings,
    });
  }),
);

/**
 * HR dashboard [HR §5]: headcount by department / branch / nationality / contract type, expiring documents and
 * contracts (30 / 60 / 90 days), request queues by type and age, secondments without report, probation ending,
 * recent transfers and promotions. Cards for modules not built yet are absent, not zero.
 */
dashboardRouter.get(
  '/hr',
  requireAuth(),
  authorize('hr.employees', 'view'),
  asyncHandler(async (req: AuthedRequest, res) => {
    if (req.authz!.scope !== 'all') throw forbidden('لوحة الموارد البشرية لمن يرى كل الموظفين');
    const now = new Date();
    const d = (days: number) => new Date(now.getTime() + days * DAY);
    const employees = await Employee.find({ deletedAt: null, status: { $nin: ['resigned', 'terminated'] } })
      .select('departmentId branchId nationality status secondment identity.expiryDate')
      .lean();
    const [depts, branches, contracts, documents, requests, probation, events] = await Promise.all([
      Department.find().select('nameAr').lean(),
      Branch.find().select('nameAr').lean(),
      Contract.find({ status: { $in: ['active', 'renewing'] } })
        .select('employeeId type endDate probationEndDate')
        .lean(),
      DocumentRecord.find({ deletedAt: null, ownerType: 'employee', expiryDate: { $ne: null, $lte: d(90) } })
        .select('expiryDate ownerId type version')
        .sort({ version: -1 })
        .lean()
        // Latest version per owner + type only (review G5).
        .then((rows) =>
          rows.filter(
            (r, i, arr) => arr.findIndex((x) => x.ownerId === r.ownerId && x.type === r.type) === i,
          ),
        ),
      HrRequest.find({ deletedAt: null, closedAt: null })
        .select('type state pendingWith createdAt stateEnteredAt')
        .lean(),
      Contract.countDocuments({
        status: { $in: ['active', 'renewing'] },
        probationEndDate: { $gte: now, $lte: d(30) },
      }),
      EmployeeEvent.find({ type: { $in: ['transfer', 'promotion'] }, at: { $gte: d(-30) } })
        .sort({ at: -1 })
        .limit(20)
        .lean(),
    ]);
    const count = <T>(items: T[], key: (x: T) => string | undefined) => {
      const m = new Map<string, number>();
      for (const i of items) {
        const k = key(i) ?? '—';
        m.set(k, (m.get(k) ?? 0) + 1);
      }
      return [...m.entries()].map(([k, v]) => ({ key: k, count: v })).sort((a, b) => b.count - a.count);
    };
    const deptName = new Map(depts.map((x) => [String(x._id), x.nameAr]));
    const branchName = new Map(branches.map((x) => [String(x._id), x.nameAr]));
    const buckets = (dates: (Date | null | undefined)[]) => ({
      d30: dates.filter((x) => x && x <= d(30)).length,
      d60: dates.filter((x) => x && x > d(30) && x <= d(60)).length,
      d90: dates.filter((x) => x && x > d(60) && x <= d(90)).length,
    });
    const ageDays = (r: { createdAt?: Date }) =>
      Math.floor((now.getTime() - new Date(r.createdAt ?? now).getTime()) / DAY);
    const employeeIds = new Set(employees.map((e) => String(e._id)));
    const liveContracts = contracts.filter((c) => employeeIds.has(String(c.employeeId)));
    res.json({
      headcount: {
        total: employees.length,
        byDepartment: count(employees, (e) => deptName.get(String(e.departmentId))).map((x) => ({
          ...x,
          departmentId: depts.find((dd) => dd.nameAr === x.key)?._id,
        })),
        byBranch: count(employees, (e) => (e.branchId ? branchName.get(String(e.branchId)) : undefined)),
        byNationality: count(employees, (e) => e.nationality),
        byContractType: count(liveContracts, (c) => c.type),
        byStatus: count(employees, (e) => e.status),
      },
      expiring: {
        contracts: buckets(liveContracts.map((c) => c.endDate)),
        identities: buckets(employees.map((e) => e.identity?.expiryDate)),
        documents: buckets(documents.map((x) => x.expiryDate)),
      },
      requests: {
        open: requests.length,
        byType: count(requests, (r) => r.type),
        byPendingWith: count(requests, (r) => r.pendingWith ?? undefined),
        byAge: {
          d0_2: requests.filter((r) => ageDays(r) <= 2).length,
          d3_7: requests.filter((r) => ageDays(r) > 2 && ageDays(r) <= 7).length,
          d8plus: requests.filter((r) => ageDays(r) > 7).length,
        },
      },
      secondmentsWithoutReport: employees.filter((e) => e.secondment?.destination && !e.secondment.reportedAt)
        .length,
      probationEnding30: probation,
      recentChanges: events.map((e) => ({
        _id: e._id,
        employeeId: e.employeeId,
        type: e.type,
        at: e.at,
        effectiveDate: e.effectiveDate,
      })),
    });
  }),
);

/** Drill-down behind the HR expiry cards (go-live review H5): the records expiring within N days, by kind. */
dashboardRouter.get(
  '/expiring',
  requireAuth(),
  authorize('hr.employees', 'view'),
  asyncHandler(async (req: AuthedRequest, res) => {
    if (req.authz!.scope !== 'all') throw forbidden('لوحة الموارد البشرية لمن يرى كل الموظفين');
    const kind = String(req.query.kind ?? 'contracts');
    const within = Math.min(Math.max(Number(req.query.within ?? 90) || 90, 1), 365);
    const now = new Date();
    const until = new Date(now.getTime() + within * DAY);
    const live = { deletedAt: null, status: { $nin: ['resigned', 'terminated'] } };
    const employees = await Employee.find(live)
      .select('fullNameAr employeeNumber departmentId identity.expiryDate identity.type')
      .lean();
    const byId = new Map(employees.map((e) => [String(e._id), e]));
    type Row = {
      employeeId: string;
      fullNameAr: string;
      employeeNumber: string;
      departmentId?: unknown;
      titleAr: string;
      expiryDate: Date;
      daysLeft: number;
    };
    const row = (employeeId: string, titleAr: string, expiryDate: Date): Row | undefined => {
      const e = byId.get(employeeId);
      if (!e) return undefined;
      return {
        employeeId,
        fullNameAr: e.fullNameAr,
        employeeNumber: e.employeeNumber,
        departmentId: e.departmentId,
        titleAr,
        expiryDate,
        daysLeft: Math.ceil((expiryDate.getTime() - now.getTime()) / DAY),
      };
    };
    let items: (Row | undefined)[] = [];
    if (kind === 'contracts') {
      const contracts = await Contract.find({
        status: { $in: ['active', 'renewing'] },
        endDate: { $ne: null, $lte: until },
      })
        .select('employeeId type endDate number')
        .lean();
      items = contracts.map((c) => row(String(c.employeeId), c.number, c.endDate!));
    } else if (kind === 'identities') {
      items = employees
        .filter((e) => e.identity?.expiryDate && e.identity.expiryDate <= until)
        .map((e) => row(String(e._id), e.identity!.type ?? 'identity', e.identity!.expiryDate!));
    } else if (kind === 'documents') {
      const docs = await DocumentRecord.find({
        deletedAt: null,
        ownerType: 'employee',
        expiryDate: { $ne: null, $lte: until },
      })
        .select('ownerId type version titleAr expiryDate')
        .sort({ version: -1 })
        .lean();
      const latest = docs.filter(
        (r, i, arr) => arr.findIndex((x) => x.ownerId === r.ownerId && x.type === r.type) === i,
      );
      items = latest.map((d) => row(d.ownerId, d.titleAr, d.expiryDate!));
    } else throw badRequest('نوع غير معروف');
    const rows = items
      .filter((x): x is Row => !!x)
      .sort((a, b) => a.expiryDate.getTime() - b.expiryDate.getTime());
    res.json({ kind, within, items: rows, total: rows.length });
  }),
);
