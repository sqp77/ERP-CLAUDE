import { User } from './core/auth/model';
import { SYSTEM_ACTOR, type Actor } from './core/http/context';
import { Employee } from './modules/hr/model';
import { HrRequest } from './modules/hr/requests.model';
import { createRequest, relationsFor, transition } from './modules/hr/requests.service';

/** Sample HR requests in different states for local testing [HR §3.5]. Idempotent. */
export async function seedRequests(): Promise<number> {
  if (await HrRequest.countDocuments()) return 0;
  const byEmail = async (email: string) => {
    const u = await User.findOne({ email });
    if (!u) throw new Error(`seed: user ${email} missing`);
    return u;
  };
  const actorOf = (u: InstanceType<typeof User>): Actor => ({
    userId: String(u._id),
    email: u.email,
    roleCodes: u.roles.map((r) => r.role),
  });
  const omar = await byEmail('omar@eayni.local');
  const rashed = await byEmail('rashed@eayni.local');
  const reem = await byEmail('reem@eayni.local');
  const khalid = await byEmail('khalid@eayni.local'); // ops manager
  const sultan = await byEmail('sultan@eayni.local'); // sales manager
  const sara = await byEmail('sara@eayni.local'); // hr officer
  const d = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

  // 1. Leave awaiting the manager (omar → khalid)
  await createRequest(
    omar,
    {
      type: 'leave',
      details: { leaveType: 'annual', startDate: d(14), endDate: d(20), reason: 'إجازة سنوية مع العائلة' },
      attachmentIds: [],
    },
    actorOf(omar),
  );
  // 2. Permission approved end to end (rashed → khalid → sara)
  let perm = await createRequest(
    rashed,
    {
      type: 'permission',
      details: { date: d(2), startTime: '09:00', endTime: '11:30', reason: 'موعد في المستشفى' },
      attachmentIds: [],
    },
    actorOf(rashed),
  );
  // Transitions return the updated document (conditional update, review B9): chain on the result, not the stale object.
  perm = await transition(perm, 'approve', {
    user: khalid,
    actor: actorOf(khalid),
    relations: await relationsFor(khalid, perm),
  });
  await transition(perm, 'approve', {
    user: sara,
    actor: actorOf(sara),
    relations: await relationsFor(sara, perm),
  });
  // 3. Salary certificate approved → certificate issued (reem → sara)
  const cert = await createRequest(
    reem,
    {
      type: 'salary_certificate',
      details: {
        addressedTo: 'بنك الرياض',
        purpose: 'تمويل سيارة',
        detailed: true,
        chamberAttestation: false,
      },
      attachmentIds: [],
    },
    actorOf(reem),
  );
  await transition(cert, 'approve', {
    user: sara,
    actor: actorOf(sara),
    relations: await relationsFor(sara, cert),
  });
  // 4. Advance handed off to Finance (omar → khalid → sara → waiting for Finance)
  let adv = await createRequest(
    omar,
    {
      type: 'advance',
      details: { amountHalalas: 300_000, reason: 'ظرف أسري طارئ', notes: 'السداد على 6 أشهر' },
      attachmentIds: [],
    },
    actorOf(omar),
  );
  adv = await transition(adv, 'approve', {
    user: khalid,
    actor: actorOf(khalid),
    relations: await relationsFor(khalid, adv),
  });
  await transition(adv, 'approve', {
    user: sara,
    actor: actorOf(sara),
    relations: await relationsFor(sara, adv),
  });
  // 5. Data update returned for completion (reem)
  const upd = await createRequest(
    reem,
    {
      type: 'data_update',
      details: {
        changes: [
          { field: 'الاسم بالإنجليزية', currentValue: 'Reem Alghamdi', newValue: 'Reem A. Alghamdi' },
        ],
        reason: 'مطابقة الجواز',
      },
      attachmentIds: [],
    },
    actorOf(reem),
  );
  await transition(upd, 'return', {
    user: sara,
    actor: actorOf(sara),
    relations: await relationsFor(sara, upd),
    reason: 'يرجى إرفاق صورة الجواز',
  });
  // 6. Official letter rejected (rashed → sara)
  const letter = await createRequest(
    rashed,
    {
      type: 'official_letter',
      details: {
        letterType: 'خطاب تعريف للسفارة',
        addressedTo: 'السفارة الفرنسية',
        purpose: 'تأشيرة سياحية',
      },
      attachmentIds: [],
    },
    actorOf(rashed),
  );
  await transition(letter, 'reject', {
    user: sara,
    actor: actorOf(sara),
    relations: await relationsFor(sara, letter),
    reason: 'نوع الخطاب غير معتمد؛ استخدم طلب التعريف بالراتب',
  });
  // 7. Remote work awaiting manager (reem → sultan)
  await createRequest(
    reem,
    {
      type: 'remote_work',
      details: { startDate: d(3), days: 2, reason: 'أعمال صيانة في المنزل' },
      attachmentIds: [],
    },
    actorOf(reem),
  );
  // 8. Experience certificate awaiting HR (rashed)
  await createRequest(
    rashed,
    { type: 'experience_certificate', details: { purpose: 'التقديم على برنامج تدريبي' }, attachmentIds: [] },
    actorOf(rashed),
  );
  void sultan;
  void SYSTEM_ACTOR;
  void Employee;
  return HrRequest.countDocuments();
}
