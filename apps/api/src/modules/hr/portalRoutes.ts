import { Router } from 'express';
import type { z } from 'zod';
import {
  bankChangeRequestSchema,
  decideChangeRequestSchema,
  secondmentReportSchema,
  updateMyContactSchema,
  updateMyPhotoSchema,
  type UpdateMyContactInput,
} from '@eayni/shared';
import { asyncHandler } from '../../core/http/async';
import { validate } from '../../core/http/validate';
import { actorFrom, type AuthedRequest } from '../../core/http/context';
import { badRequest, conflict, notFound } from '../../core/http/errors';
import { requireAuth } from '../../core/auth/middleware';
import { authorize } from '../../core/rbac/authorize';
import { recordAudit } from '../../core/audit/service';
import { nextNumber } from '../../core/numbering/service';
import { notify } from '../../core/notifications/service';
import { Attachment } from '../../core/files/model';
import { decrypt, encrypt } from '../../core/auth/crypto';
import { Branch, Department, Position, Site, Unit } from '../../core/org/model';
import { Contract, Employee } from './model';
import { ProfileChangeRequest } from './profileChanges.model';
import { employeeOfUser, hrUserIds, serializeEmployee, updateEmployee } from './service';

export const portalRouter = Router();

async function myEmployee(req: AuthedRequest) {
  const e = await employeeOfUser(String(req.auth.user._id));
  if (!e) throw notFound('لا يوجد ملف موظف مرتبط بحسابك');
  return e;
}

/** Own file with display labels for the portal profile [EP §5–8]. */
portalRouter.get(
  '/me',
  requireAuth(),
  asyncHandler(async (req: AuthedRequest, res) => {
    const e = await myEmployee(req);
    const [dept, unit, pos, branch, site, manager, contract, pendingChanges] = await Promise.all([
      Department.findById(e.departmentId).select('nameAr').lean(),
      e.unitId ? Unit.findById(e.unitId).select('nameAr').lean() : null,
      e.positionId ? Position.findById(e.positionId).select('titleAr grade').lean() : null,
      e.branchId ? Branch.findById(e.branchId).select('nameAr city').lean() : null,
      e.siteId ? Site.findById(e.siteId).select('nameAr').lean() : null,
      e.directManagerId
        ? Employee.findById(e.directManagerId).select('fullNameAr userId workEmail').lean()
        : null,
      Contract.findOne({ employeeId: e._id, status: { $in: ['active', 'renewing'] } })
        .sort({ version: -1 })
        .lean(),
      ProfileChangeRequest.find({ employeeId: e._id, state: 'pending' }).lean(),
    ]);
    const data = serializeEmployee(e, { self: true, hidden: new Set() });
    const probation = contract?.probationEndDate
      ? { endDate: contract.probationEndDate, inProbation: contract.probationEndDate > new Date() }
      : null;
    res.json({
      ...data,
      labels: {
        department: dept?.nameAr,
        unit: unit?.nameAr,
        position: pos?.titleAr,
        branch: branch?.nameAr,
        site: site?.nameAr,
        directManager: manager?.fullNameAr,
        directManagerUserId: manager?.userId,
      },
      currentContract: contract ? { ...contract, probation } : null,
      pendingChanges: pendingChanges.map((c) => ({
        _id: c._id,
        number: c.number,
        type: c.type,
        state: c.state,
        createdAt: c.createdAt,
      })),
    });
  }),
);

/** Contact info and national address save directly, logged, HR notified (DECISIONS §10) [EP §5.4, §5.5]. */
portalRouter.patch(
  '/me/contact',
  requireAuth(),
  validate(updateMyContactSchema),
  asyncHandler(async (req: AuthedRequest, res) => {
    const e = await myEmployee(req);
    const body = req.body as UpdateMyContactInput;
    const updated = await updateEmployee(String(e._id), body, actorFrom(req), false);
    const hr = await hrUserIds();
    if (hr.length)
      await notify({
        userIds: hr,
        type: 'employee.data_updated',
        bodyAr: `${e.fullNameAr} حدّث بيانات التواصل: ${Object.keys(body).join('، ')}`,
        link: `/hr/employees/${e._id}`,
      });
    res.json(serializeEmployee(updated, { self: true, hidden: new Set() }));
  }),
);

/** Profile photo [EP §5.1]. */
portalRouter.post(
  '/me/photo',
  requireAuth(),
  validate(updateMyPhotoSchema),
  asyncHandler(async (req: AuthedRequest, res) => {
    const e = await myEmployee(req);
    const { attachmentId } = req.body as z.infer<typeof updateMyPhotoSchema>;
    const att = await Attachment.findOne({
      _id: attachmentId,
      uploadedBy: req.auth.user._id,
      status: 'uploaded',
      deletedAt: null,
    });
    if (!att || !att.mimeType.startsWith('image/')) throw badRequest('الصورة غير صالحة');
    const before = e.photoAttachmentId;
    e.photoAttachmentId = att._id;
    await e.save();
    await recordAudit(actorFrom(req), {
      action: 'update',
      resource: 'hr.employees',
      resourceId: String(e._id),
      before: { photoAttachmentId: before },
      after: { photoAttachmentId: att._id },
    });
    res.json({ photoAttachmentId: att._id });
  }),
);

/** Bank account change request → Finance approval with proof [EP §8.1, DECISIONS §10]. */
portalRouter.post(
  '/me/bank-change',
  requireAuth(),
  authorize('hr.profile_changes', 'create'),
  validate(bankChangeRequestSchema),
  asyncHandler(async (req: AuthedRequest, res) => {
    const e = await myEmployee(req);
    const body = req.body as z.infer<typeof bankChangeRequestSchema>;
    if (await ProfileChangeRequest.exists({ employeeId: e._id, type: 'bank', state: 'pending' }))
      throw conflict('يوجد طلب تغيير حساب بنكي بانتظار الاعتماد');
    const proof = await Attachment.findOne({
      _id: body.proofAttachmentId,
      uploadedBy: req.auth.user._id,
      status: 'uploaded',
      deletedAt: null,
    });
    if (!proof) throw badRequest('مستند إثبات الحساب مطلوب');
    const pcr = await ProfileChangeRequest.create({
      number: await nextNumber('profileChange'),
      employeeId: e._id,
      userId: req.auth.user._id,
      type: 'bank',
      payload: {
        bankName: body.bankName,
        ibanEnc: encrypt(body.iban.toUpperCase()),
        ibanLast4: body.iban.slice(-4),
      },
      proofAttachmentId: proof._id,
      notes: body.notes,
    });
    await recordAudit(actorFrom(req), {
      action: 'create',
      resource: 'hr.profile_changes',
      resourceId: String(pcr._id),
      after: { number: pcr.number, type: 'bank' },
      sensitive: true,
    });
    const { User } = await import('../../core/auth/model');
    const finance = await User.find({
      'roles.role': { $in: ['finance_staff', 'finance_manager'] },
      status: 'active',
    })
      .select('_id')
      .lean();
    await notify({
      userIds: finance.map((u) => String(u._id)),
      type: 'generic',
      titleAr: 'طلب تغيير حساب بنكي بانتظار اعتمادكم',
      bodyAr: `${e.fullNameAr} — ${pcr.number}`,
      link: '/hr/profile-changes',
    });
    res.status(201).json({ _id: pcr._id, number: pcr.number, state: pcr.state, createdAt: pcr.createdAt });
  }),
);

portalRouter.get(
  '/me/change-requests',
  requireAuth(),
  asyncHandler(async (req: AuthedRequest, res) => {
    const e = await myEmployee(req);
    const items = await ProfileChangeRequest.find({ employeeId: e._id }).sort({ createdAt: -1 }).lean();
    res.json({
      items: items.map((c) => ({
        _id: c._id,
        number: c.number,
        type: c.type,
        state: c.state,
        bankName: c.payload?.bankName,
        ibanLast4: c.payload?.ibanLast4,
        decidedAt: c.decidedAt,
        decisionReason: c.decisionReason,
        createdAt: c.createdAt,
      })),
    });
  }),
);

portalRouter.post(
  '/me/change-requests/:id/cancel',
  requireAuth(),
  asyncHandler(async (req: AuthedRequest, res) => {
    const e = await myEmployee(req);
    const pcr = await ProfileChangeRequest.findOne({
      _id: req.params.id,
      employeeId: e._id,
      state: 'pending',
    });
    if (!pcr) throw notFound();
    pcr.state = 'cancelled';
    await pcr.save();
    res.json({ ok: true });
  }),
);

/** Secondment report upload → direct manager notified [EP §5.3, EP §15.14]. */
portalRouter.post(
  '/me/secondment-report',
  requireAuth(),
  validate(secondmentReportSchema),
  asyncHandler(async (req: AuthedRequest, res) => {
    const e = await myEmployee(req);
    // Allowed during and after the secondment [EP §5.3: the report follows the mission]; a new upload replaces the old one.
    if (!e.secondment?.destination) throw badRequest('لا يوجد انتداب مسجّل في ملفك');
    const body = req.body as z.infer<typeof secondmentReportSchema>;
    e.secondment.reportAttachmentId = body.attachmentId as never;
    e.secondment.reportedAt = new Date();
    e.secondment.reportNotes = body.notes;
    await e.save();
    const { EmployeeEvent } = await import('./model');
    await EmployeeEvent.create({
      employeeId: e._id,
      type: 'secondment_report',
      to: { attachmentId: body.attachmentId, notes: body.notes },
      actorUserId: String(req.auth.user._id),
      actorEmail: req.auth.user.email,
    });
    const manager = e.directManagerId
      ? await Employee.findById(e.directManagerId).select('userId').lean()
      : null;
    if (manager?.userId)
      await notify({
        userIds: [String(manager.userId)],
        type: 'generic',
        titleAr: 'تم رفع تقرير انتداب',
        bodyAr: `${e.fullNameAr} رفع تقرير الانتداب إلى ${e.secondment.destination}`,
        link: `/hr/employees/${e._id}`,
      });
    res.json({ ok: true });
  }),
);

// ---------- approvals queue (Finance decides bank changes; HR sees the queue) ----------
export const profileChangesRouter = Router();

profileChangesRouter.get(
  '/',
  requireAuth(),
  authorize('hr.profile_changes', 'view'),
  asyncHandler(async (req: AuthedRequest, res) => {
    const state = typeof req.query.state === 'string' ? req.query.state : 'pending';
    const filter: Record<string, unknown> = state === 'all' ? {} : { state };
    if (req.authz!.scope === 'own') filter.userId = req.auth.user._id;
    const items = await ProfileChangeRequest.find(filter).sort({ createdAt: -1 }).limit(200).lean();
    const employees = await Employee.find({ _id: { $in: items.map((i) => i.employeeId) } })
      .select('fullNameAr employeeNumber departmentId')
      .lean();
    const byId = new Map(employees.map((e) => [String(e._id), e]));
    res.json({
      items: items.map((c) => ({
        _id: c._id,
        number: c.number,
        type: c.type,
        state: c.state,
        employee: byId.get(String(c.employeeId)),
        bankName: c.payload?.bankName,
        ibanLast4: c.payload?.ibanLast4,
        proofAttachmentId: c.proofAttachmentId,
        notes: c.notes,
        createdAt: c.createdAt,
        decidedAt: c.decidedAt,
        decisionReason: c.decisionReason,
      })),
    });
  }),
);

async function decide(req: AuthedRequest, approve: boolean) {
  const pcr = await ProfileChangeRequest.findOne({ _id: req.params.id, state: 'pending' });
  if (!pcr) throw notFound('الطلب غير موجود أو تم البت فيه');
  if (String(pcr.userId) === String(req.auth.user._id)) throw badRequest('لا يمكنك اعتماد طلبك (فصل المهام)');
  const { reason } = req.body as z.infer<typeof decideChangeRequestSchema>;
  if (!approve && !reason?.trim()) throw badRequest('سبب الرفض مطلوب');
  const employee = await Employee.findById(pcr.employeeId);
  if (!employee) throw notFound();
  if (approve && pcr.type === 'bank' && pcr.payload?.ibanEnc) {
    const before = { bankName: employee.bank?.bankName, ibanLast4: employee.bank?.ibanLast4 };
    employee.bank = {
      bankName: pcr.payload.bankName,
      ibanEnc: pcr.payload.ibanEnc,
      ibanLast4: pcr.payload.ibanLast4,
    };
    await employee.save();
    await recordAudit(actorFrom(req), {
      action: 'approve',
      resource: 'hr.employees',
      resourceId: String(employee._id),
      before,
      after: { bankName: pcr.payload.bankName, ibanLast4: pcr.payload.ibanLast4 },
      sensitive: true,
      meta: { profileChange: pcr.number },
    });
  }
  pcr.state = approve ? 'approved' : 'rejected';
  pcr.decidedBy = req.auth.user._id;
  pcr.decidedAt = new Date();
  pcr.decisionReason = reason;
  await pcr.save();
  await recordAudit(actorFrom(req), {
    action: approve ? 'approve' : 'reject',
    resource: 'hr.profile_changes',
    resourceId: String(pcr._id),
    meta: { reason },
  });
  await notify({
    userIds: [String(pcr.userId)],
    type: 'request.decided',
    bodyAr: approve
      ? `تم اعتماد تغيير الحساب البنكي (${pcr.number})`
      : `تم رفض تغيير الحساب البنكي (${pcr.number}): ${reason}`,
    link: '/me/profile',
  });
  return pcr;
}

profileChangesRouter.post(
  '/:id/approve',
  requireAuth(),
  authorize('hr.profile_changes', 'approve'),
  validate(decideChangeRequestSchema),
  asyncHandler(async (req: AuthedRequest, res) => res.json(await decide(req, true))),
);
profileChangesRouter.post(
  '/:id/reject',
  requireAuth(),
  authorize('hr.profile_changes', 'approve'),
  validate(decideChangeRequestSchema),
  asyncHandler(async (req: AuthedRequest, res) => res.json(await decide(req, false))),
);

/** Used by tests/admin to read a decrypted IBAN of an approved request (audited). */
export function decryptIban(enc?: string): string | undefined {
  return enc ? decrypt(enc) : undefined;
}
