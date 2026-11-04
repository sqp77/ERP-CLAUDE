import { randomUUID } from 'node:crypto';
import { CONTRACT_TYPE_AR, EMPLOYMENT_TYPE_AR } from '@eayni/shared';
import { htmlDocument, renderTemplate } from '../../core/templates/render';
import { storage } from '../../core/files/storage';
import { Attachment } from '../../core/files/model';
import { nextNumber } from '../../core/numbering/service';
import { getSetting } from '../../core/settings/service';
import { Department, Position } from '../../core/org/model';
import { Contract, type EmployeeDoc } from './model';
import type { HrRequestDoc } from './requests.model';

/**
 * Certificates generated from templates and auto-filled from the employee file [HR §3.5.4–3.5.5].
 * Output is an RTL HTML document stored as an attachment; the PDF renderer (pending, DECISIONS §1)
 * will produce PDF from the same HTML.
 */
const SALARY_TEMPLATE = `
<div style="text-align:center"><h2>{{orgName}}</h2><h3>تعريف بالراتب</h3><p>رقم: {{number}} · التاريخ: {{date issuedAt}} ({{hijri issuedAt}})</p></div>
<p>إلى / {{addressedTo}} المحترمين،</p>
<p>تشهد {{orgName}} بأن {{genderTitle}} <strong>{{fullNameAr}}</strong>، {{idLabel}} رقم <span dir="ltr">{{idNumber}}</span>، {{nationality}} الجنسية،
يعمل لدينا منذ {{date hireDate}} بوظيفة <strong>{{position}}</strong> في {{department}}، بنظام {{employmentType}}،
{{#if detailed}}ويتقاضى راتبًا أساسيًا قدره {{money basic}}{{#if allowances.length}} إضافة إلى البدلات التالية:{{/if}}</p>
{{#if allowances.length}}<table><thead><tr><th>البدل</th><th>المبلغ</th></tr></thead><tbody>{{#each allowances}}<tr><td>{{type}}</td><td>{{money amountHalalas}}</td></tr>{{/each}}</tbody></table>{{/if}}
<p>ليكون إجمالي الراتب الشهري {{money total}}.</p>
{{else}}ويتقاضى راتبًا شهريًا إجماليًا قدره <strong>{{money total}}</strong>.</p>{{/if}}
<p>وقد أُعطيت له هذه الشهادة بناءً على طلبه لتقديمها إلى الجهة المذكورة أعلاه ({{purpose}}) دون أدنى مسؤولية على الجمعية تجاه الغير.</p>
{{#if chamberAttestation}}<p><em>مطلوب تصديق الغرفة التجارية.</em></p>{{/if}}
<p style="margin-top:48px">إدارة الموارد البشرية</p>`;

const EXPERIENCE_TEMPLATE = `
<div style="text-align:center"><h2>{{orgName}}</h2><h3>شهادة خبرة</h3><p>رقم: {{number}} · التاريخ: {{date issuedAt}} ({{hijri issuedAt}})</p></div>
<p>تشهد {{orgName}} بأن {{genderTitle}} <strong>{{fullNameAr}}</strong>، {{idLabel}} رقم <span dir="ltr">{{idNumber}}</span>، {{nationality}} الجنسية،
{{#if endDate}}عمل لدينا خلال الفترة من {{date hireDate}} إلى {{date endDate}}{{else}}يعمل لدينا منذ {{date hireDate}} حتى تاريخه{{/if}}
بوظيفة <strong>{{position}}</strong> في {{department}} بعقد {{contractType}}.</p>
<p>وقد أُعطيت له هذه الشهادة بناءً على طلبه ({{purpose}}) دون أدنى مسؤولية على الجمعية تجاه الغير، متمنين له التوفيق.</p>
<p style="margin-top:48px">إدارة الموارد البشرية</p>`;

export async function issueCertificate(
  request: HrRequestDoc,
  employee: EmployeeDoc,
  issuedBy: string,
): Promise<{ number: string; attachmentId: string; html: string }> {
  const [orgName, dept, pos, contract] = await Promise.all([
    getSetting('general.organizationNameAr'),
    Department.findById(employee.departmentId).select('nameAr').lean(),
    employee.positionId ? Position.findById(employee.positionId).select('titleAr').lean() : null,
    Contract.findOne({ employeeId: employee._id }).sort({ version: -1 }).lean(),
  ]);
  const number = await nextNumber('certificate');
  const issuedAt = new Date();
  const details = request.details as Record<string, unknown>;
  const { decrypt } = await import('../../core/auth/crypto');
  const allowances = (employee.allowances ?? []).map((a) => ({
    type: a.type,
    amountHalalas: a.amountHalalas ?? 0,
  }));
  const basic = employee.basicSalaryHalalas ?? 0;
  const total = basic + allowances.reduce((s, a) => s + a.amountHalalas, 0);
  const identity = employee.identity!;
  const data = {
    orgName,
    number,
    issuedAt,
    fullNameAr: employee.fullNameAr,
    genderTitle: employee.gender === 'female' ? 'السيدة' : 'السيد',
    idLabel: identity.type === 'iqama' ? 'إقامة' : identity.type === 'passport' ? 'جواز سفر' : 'هوية وطنية',
    idNumber: decrypt(identity.numberEnc),
    nationality: employee.nationality,
    hireDate: employee.hireDate,
    endDate: employee.endDate,
    position: pos?.titleAr ?? '—',
    department: dept?.nameAr ?? '—',
    employmentType:
      EMPLOYMENT_TYPE_AR[employee.employmentType as keyof typeof EMPLOYMENT_TYPE_AR] ??
      employee.employmentType,
    contractType: contract
      ? (CONTRACT_TYPE_AR[contract.type as keyof typeof CONTRACT_TYPE_AR] ?? contract.type)
      : 'عمل',
    basic,
    total,
    allowances,
    addressedTo: details.addressedTo,
    purpose: details.purpose,
    detailed: !!details.detailed,
    chamberAttestation: !!details.chamberAttestation,
  };
  const body = renderTemplate(
    request.type === 'salary_certificate' ? SALARY_TEMPLATE : EXPERIENCE_TEMPLATE,
    data,
  );
  const html = htmlDocument(body, `${number}`);
  const key = `certificates/${issuedAt.getUTCFullYear()}/${number}-${randomUUID().slice(0, 8)}.html`;
  await storage().putObject(key, Buffer.from(html, 'utf8'), 'text/html; charset=utf-8');
  const att = await Attachment.create({
    key,
    originalName: `${number}.html`,
    mimeType: 'text/html',
    size: Buffer.byteLength(html),
    status: 'uploaded',
    uploadedAt: issuedAt,
    uploadedBy: issuedBy,
    ownerType: 'hr_request',
    ownerId: String(request._id),
    sensitive: true,
  });
  return { number, attachmentId: String(att._id), html };
}
