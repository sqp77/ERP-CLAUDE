import { useState } from 'react';
import { useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { lookupKeys, useBranches, useSites } from '@/lib/lookups';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { post } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import {
  Alert,
  Button,
  Card,
  Dialog,
  Field,
  Input,
  PageHeader,
  Select,
  Spinner,
  Table,
  Td,
  QueryError,
} from '@/shared/ui';
import { useToast } from '@/shared/ui/Toast';

interface Branch {
  _id: string;
  code: string;
  nameAr: string;
  region?: string;
  city?: string;
}
interface Site {
  _id: string;
  branchId: string;
  nameAr: string;
  location?: { coordinates: [number, number] };
  geofenceRadiusM?: number;
}

/** Branches and operating sites with geofence coordinates [HR §3.1.5, §3.4]. Real sites are pending (DECISIONS §3). */
export function BranchesPage() {
  const { t } = useTranslation();
  const toast = useToast();
  const qc = useQueryClient();
  const branches = useBranches() as unknown as UseQueryResult<{ items: Branch[] }>;
  const sites = useSites() as unknown as UseQueryResult<{ items: Site[] }>;
  const [dialog, setDialog] = useState<'branch' | 'site' | null>(null);
  const [error, setError] = useState<string>();
  const bf = useForm<{ code: string; nameAr: string; region?: string; city?: string; address?: string }>();
  const sf = useForm<{
    branchId: string;
    nameAr: string;
    lat?: string;
    lng?: string;
    geofenceRadiusM?: string;
  }>();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: lookupKeys.branches });
    qc.invalidateQueries({ queryKey: lookupKeys.sites });
  };
  const saveBranch = bf.handleSubmit(async (v) => {
    try {
      await post('/org/branches', v);
      setDialog(null);
      bf.reset();
      invalidate();
      toast(t('actions.save'));
    } catch (e) {
      setError(errorMessage(e));
    }
  });
  const saveSite = sf.handleSubmit(async (v) => {
    try {
      await post('/org/sites', {
        branchId: v.branchId,
        nameAr: v.nameAr,
        location: v.lat && v.lng ? { lat: Number(v.lat), lng: Number(v.lng) } : null,
        geofenceRadiusM: v.geofenceRadiusM ? Number(v.geofenceRadiusM) : null,
      });
      setDialog(null);
      sf.reset();
      invalidate();
      toast(t('actions.save'));
    } catch (e) {
      setError(errorMessage(e));
    }
  });
  const branchName = (id: string) => branches.data?.items.find((b) => b._id === id)?.nameAr ?? '';

  return (
    <>
      <PageHeader
        title={t('nav.branches')}
        actions={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setError(undefined);
                setDialog('site');
              }}
            >
              {t('admin.org.newSite')}
            </Button>
            <Button
              onClick={() => {
                setError(undefined);
                setDialog('branch');
              }}
            >
              {t('admin.org.newBranch')}
            </Button>
          </>
        }
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={t('admin.org.branches')}>
          {branches.isError ? (
            <QueryError error={branches.error} onRetry={() => branches.refetch()} />
          ) : branches.isLoading ? (
            <Spinner />
          ) : (
            <Table head={[t('common.code'), t('common.name'), t('admin.org.region'), t('admin.org.city')]}>
              {branches.data?.items.map((b) => (
                <tr key={b._id}>
                  <Td>
                    <code className="text-xs">{b.code}</code>
                  </Td>
                  <Td className="font-medium">{b.nameAr}</Td>
                  <Td>{b.region}</Td>
                  <Td>{b.city}</Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
        <Card title={t('admin.org.sites')}>
          {sites.isError ? (
            <QueryError error={sites.error} onRetry={() => sites.refetch()} />
          ) : sites.isLoading ? (
            <Spinner />
          ) : (
            <Table
              head={[
                t('common.name'),
                t('admin.org.branch'),
                t('admin.org.coordinates'),
                t('admin.org.geofence'),
              ]}
            >
              {sites.data?.items.map((s) => (
                <tr key={s._id}>
                  <Td className="font-medium">{s.nameAr}</Td>
                  <Td>{branchName(s.branchId)}</Td>
                  <Td dir="ltr" className="tabular text-xs">
                    {s.location ? `${s.location.coordinates[1]}, ${s.location.coordinates[0]}` : '—'}
                  </Td>
                  <Td className="tabular">{s.geofenceRadiusM ?? '—'}</Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      </div>
      <Dialog open={dialog === 'branch'} onClose={() => setDialog(null)} title={t('admin.org.newBranch')}>
        <form onSubmit={saveBranch} className="space-y-3" noValidate>
          {error && <Alert kind="error">{error}</Alert>}
          <Field label={t('common.code')} required>
            <Input dir="ltr" {...bf.register('code', { required: true })} />
          </Field>
          <Field label={t('common.name')} required>
            <Input {...bf.register('nameAr', { required: true })} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('admin.org.region')}>
              <Input {...bf.register('region')} />
            </Field>
            <Field label={t('admin.org.city')}>
              <Input {...bf.register('city')} />
            </Field>
          </div>
          <Field label={t('admin.org.address')}>
            <Input {...bf.register('address')} />
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setDialog(null)}>
              {t('actions.cancel')}
            </Button>
            <Button type="submit" loading={bf.formState.isSubmitting}>
              {t('actions.save')}
            </Button>
          </div>
        </form>
      </Dialog>
      <Dialog open={dialog === 'site'} onClose={() => setDialog(null)} title={t('admin.org.newSite')}>
        <form onSubmit={saveSite} className="space-y-3" noValidate>
          {error && <Alert kind="error">{error}</Alert>}
          <Field label={t('admin.org.branch')} required>
            <Select {...sf.register('branchId', { required: true })}>
              <option value="">—</option>
              {branches.data?.items.map((b) => (
                <option key={b._id} value={b._id}>
                  {b.nameAr}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('common.name')} required>
            <Input {...sf.register('nameAr', { required: true })} />
          </Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label={t('admin.org.lat')}>
              <Input dir="ltr" inputMode="decimal" {...sf.register('lat')} />
            </Field>
            <Field label={t('admin.org.lng')}>
              <Input dir="ltr" inputMode="decimal" {...sf.register('lng')} />
            </Field>
            <Field label={t('admin.org.geofence')}>
              <Input dir="ltr" inputMode="numeric" {...sf.register('geofenceRadiusM')} />
            </Field>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setDialog(null)}>
              {t('actions.cancel')}
            </Button>
            <Button type="submit" loading={sf.formState.isSubmitting}>
              {t('actions.save')}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
