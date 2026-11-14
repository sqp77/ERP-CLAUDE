import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NOTIFICATION_TITLES_AR, NOTIFICATION_TYPES } from '@eayni/shared';

/**
 * SAL §14 hygiene [SAL §18 (17) «نظام الإشعارات»]: each of the sixteen notifications the Sales spec lists has a type
 * in the registry, an Arabic title, a badge label in the web locale, and at least one place in the API that emits it.
 * A pure source check (no database), so it also guards against a type being renamed in one place only.
 */
const SAL14: [number, string, string[]][] = [
  [1, 'وصول عميل جديد من خدمة العملاء', ['crm.lead.referred']],
  [2, 'إسناد عميل إلى موظف', ['crm.customer.assigned']],
  [3, 'قرب موعد متابعة العميل', ['crm.followup.due']],
  [4, 'اقتراب موعد اجتماع أو زيارة', ['meeting.reminder']],
  [5, 'تحديث حالة عرض السعر', ['sales.quote.status']],
  [6, 'اعتماد أو رفض عرض السعر', ['sales.quote.decided']],
  [7, 'وصول طلب جديد إلى المشتريات', ['sales.request.to_procurement']],
  [8, 'اعتماد أو رفض الطلب من المالية', ['sales.request.finance_decided']],
  [9, 'تحديث حالة الطلب من المشتريات', ['sales.request.procurement_updated']],
  [10, 'اكتمال التنفيذ من التشغيل', ['sales.request.operations_completed']],
  [11, 'إصدار فاتورة جديدة', ['finance.invoice.issued']],
  [12, 'تأخر سداد الفاتورة', ['finance.invoice.overdue']],
  [13, 'اقتراب انتهاء عقد', ['sales.contract.expiring']],
  [14, 'اقتراب موعد تجديد التعاون', ['sales.contract.renewal_due']],
  [15, 'وجود مشكلة أو استفسار من قسم آخر', ['discussion.opened']],
  [16, 'تغيير الموظف المسؤول عن العميل أو الطلب', ['crm.owner_changed']],
];

const API_SRC = join(__dirname, '..', '..');
const WEB_LOCALE = join(API_SRC, '..', '..', 'web', 'src', 'locales', 'ar', 'common.json');

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...sources(p));
    else if (p.endsWith('.ts') && !p.endsWith('.test.ts')) out.push(readFileSync(p, 'utf8'));
  }
  return out;
}

describe('SAL §14 notifications [SAL §14, §18 (17)]', () => {
  const code = sources(API_SRC).join('\n');
  const badges = (
    JSON.parse(readFileSync(WEB_LOCALE, 'utf8')) as { notifications: { types: Record<string, string> } }
  ).notifications.types;

  it('lists all sixteen', () => {
    expect(SAL14.map(([n]) => n)).toEqual(Array.from({ length: 16 }, (_, i) => i + 1));
  });

  it.each(SAL14)(
    '%i %s: registered, titled in Arabic, labelled in the web, emitted by the API',
    (_n, _label, types) => {
      for (const type of types) {
        expect(NOTIFICATION_TYPES as readonly string[], type).toContain(type);
        expect(NOTIFICATION_TITLES_AR[type as (typeof NOTIFICATION_TYPES)[number]], type).toMatch(/[؀-ۿ]/);
        expect(badges[type], `web badge label for ${type}`).toMatch(/[؀-ۿ]/);
        // Emitted: the type appears as a string literal in the API code (outside tests and the shared registry).
        expect(code.includes(`'${type}'`), `no API code emits ${type}`).toBe(true);
      }
    },
  );
});
