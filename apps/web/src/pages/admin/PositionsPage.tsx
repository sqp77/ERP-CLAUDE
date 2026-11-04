import { useTranslation } from 'react-i18next';
import { Field, Input, Select, Textarea } from '@/shared/ui';
import { MasterDataPage } from './MasterDataPage';
import { useDepartments } from './_shared';

interface Position {
  _id: string;
  code: string;
  titleAr: string;
  departmentId?: string | null;
  grade?: string;
  descriptionAr?: string;
  active: boolean;
}
type F = { code: string; titleAr: string; departmentId: string; grade: string; descriptionAr: string; active: boolean };

/** Positions with job descriptions [HR §3.1.4]. */
export function PositionsPage() {
  const { t } = useTranslation();
  const depts = useDepartments();
  const name = (id?: string | null) => depts.data?.items.find((d) => d._id === id)?.nameAr ?? '';
  return (
    <MasterDataPage<Position, F>
      title={t('admin.org.positions')}
      newLabel={t('admin.org.newPosition')}
      endpoint="/org/positions"
      queryKey="positions"
      columns={[
        { label: t('common.code'), render: (p) => <code className="text-xs">{p.code}</code> },
        { label: t('hr.position'), render: (p) => <span className="font-medium">{p.titleAr}</span> },
        { label: t('admin.users.department'), render: (p) => name(p.departmentId) },
        { label: t('hr.grade'), render: (p) => p.grade },
      ]}
      toForm={(p) => ({ code: p?.code ?? '', titleAr: p?.titleAr ?? '', departmentId: p?.departmentId ?? '', grade: p?.grade ?? '', descriptionAr: p?.descriptionAr ?? '', active: p?.active ?? true })}
      toBody={(v, isNew) => ({ ...(isNew ? { code: v.code } : {}), titleAr: v.titleAr, departmentId: v.departmentId || null, grade: v.grade || undefined, descriptionAr: v.descriptionAr || undefined, active: v.active })}
      fields={(form, isNew) => (
        <>
          <Field label={t('common.code')} required><Input dir="ltr" disabled={!isNew} {...form.register('code', { required: true })} /></Field>
          <Field label={t('hr.position')} required><Input {...form.register('titleAr', { required: true })} /></Field>
          <Field label={t('admin.users.department')}>
            <Select {...form.register('departmentId')}>
              <option value="">—</option>
              {depts.data?.items.map((d) => <option key={d._id} value={d._id}>{d.nameAr}</option>)}
            </Select>
          </Field>
          <Field label={t('hr.grade')}><Input dir="ltr" {...form.register('grade')} /></Field>
          <Field label={t('hr.jobDescription')}><Textarea rows={3} {...form.register('descriptionAr')} /></Field>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" {...form.register('active')} /> {t('common.active')}</label>
        </>
      )}
    />
  );
}
