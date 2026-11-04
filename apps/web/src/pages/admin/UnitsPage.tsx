import { useTranslation } from 'react-i18next';
import { Field, Input, Select } from '@/shared/ui';
import { MasterDataPage } from './MasterDataPage';
import { useDepartments } from './_shared';

interface Unit {
  _id: string;
  departmentId: string;
  nameAr: string;
  active: boolean;
}
type F = { departmentId: string; nameAr: string; active: boolean };

/** Units under departments [HR §3.1.2]. */
export function UnitsPage() {
  const { t } = useTranslation();
  const depts = useDepartments();
  const name = (id: string) => depts.data?.items.find((d) => d._id === id)?.nameAr ?? '';
  return (
    <MasterDataPage<Unit, F>
      title={t('admin.org.units')}
      newLabel={t('admin.org.newUnit')}
      endpoint="/org/units"
      queryKey="units"
      columns={[
        { label: t('common.name'), render: (u) => <span className="font-medium">{u.nameAr}</span> },
        { label: t('admin.users.department'), render: (u) => name(u.departmentId) },
      ]}
      toForm={(u) => ({
        departmentId: u?.departmentId ?? '',
        nameAr: u?.nameAr ?? '',
        active: u?.active ?? true,
      })}
      toBody={(v) => v}
      fields={(form) => (
        <>
          <Field label={t('admin.users.department')} required>
            <Select {...form.register('departmentId', { required: true })}>
              <option value="">—</option>
              {depts.data?.items.map((d) => (
                <option key={d._id} value={d._id}>
                  {d.nameAr}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('common.name')} required>
            <Input {...form.register('nameAr', { required: true })} />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" {...form.register('active')} /> {t('common.active')}
          </label>
        </>
      )}
    />
  );
}
