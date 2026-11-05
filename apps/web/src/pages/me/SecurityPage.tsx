import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/lib/auth';
import { usePrefs } from '@/lib/preferences';
import { del, get, post } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { Alert, Badge, Button, Card, Dialog, Field, Input, PageHeader, Table, Td } from '@/shared/ui';
import { useToast } from '@/shared/ui/Toast';

interface S {
  _id: string;
  createdAt: string;
  lastSeenAt: string;
  ip?: string;
  userAgent?: string;
  current: boolean;
}

/** Active sessions, password change and TOTP management [EP §3 security requirements]. */
export function SecurityPage() {
  const { t } = useTranslation();
  const { user, refresh } = useAuth();
  const { formatDateTime } = usePrefs();
  const toast = useToast();
  const qc = useQueryClient();
  const sessions = useQuery({ queryKey: ['sessions'], queryFn: () => get<{ items: S[] }>('/auth/sessions') });
  const revoke = useMutation({
    mutationFn: (id: string) => del(`/auth/sessions/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sessions'] }),
  });

  const pw = useForm<{ currentPassword: string; newPassword: string; confirm: string }>();
  const [pwError, setPwError] = useState<string>();
  const changePw = pw.handleSubmit(async (v) => {
    if (v.newPassword !== v.confirm) return pw.setError('confirm', { message: t('auth.passwordMismatch') });
    try {
      await post('/auth/password/change', { currentPassword: v.currentPassword, newPassword: v.newPassword });
      toast(t('auth.passwordChanged'));
      pw.reset();
      setPwError(undefined);
      qc.invalidateQueries({ queryKey: ['sessions'] });
    } catch (e) {
      setPwError(errorMessage(e));
    }
  });

  const [mfaDialog, setMfaDialog] = useState<'enable' | 'disable' | null>(null);
  const [enroll, setEnroll] = useState<{ qrDataUrl: string; manualKey: string }>();
  const [code, setCode] = useState('');
  const [mfaError, setMfaError] = useState<string>();
  const openEnable = async () => {
    setMfaDialog('enable');
    setEnroll(await post('/auth/mfa/enroll/start'));
  };
  const submitMfa = async () => {
    try {
      await post(mfaDialog === 'enable' ? '/auth/mfa/enroll/confirm' : '/auth/mfa/disable', { code });
      await refresh();
      setMfaDialog(null);
      setCode('');
      toast(t('actions.save'));
    } catch (e) {
      setMfaError(errorMessage(e));
    }
  };

  return (
    <>
      <PageHeader title={t('nav.security')} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={t('auth.mfaTitle')}>
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Badge tone={user?.mfaEnabled ? 'green' : 'amber'}>
                {user?.mfaEnabled ? t('auth.mfaEnabled') : t('auth.mfaDisabled')}
              </Badge>
              {user?.mfaRequired && <Badge tone="brand">{t('auth.mfaMandatory')}</Badge>}
            </div>
            {user?.mfaEnabled ? (
              <Button variant="secondary" disabled={user.mfaRequired} onClick={() => setMfaDialog('disable')}>
                {t('auth.mfaDisable')}
              </Button>
            ) : (
              <Button onClick={openEnable}>{t('auth.mfaEnable')}</Button>
            )}
          </div>
        </Card>

        <Card title={t('auth.changePassword')}>
          <form onSubmit={changePw} className="space-y-3" noValidate>
            {pwError && <Alert kind="error">{pwError}</Alert>}
            <Field label={t('auth.currentPassword')} required>
              <Input
                type="password"
                dir="ltr"
                autoComplete="current-password"
                {...pw.register('currentPassword', { required: true })}
              />
            </Field>
            <Field label={t('auth.newPassword')} required>
              <Input
                type="password"
                dir="ltr"
                autoComplete="new-password"
                {...pw.register('newPassword', { required: true, minLength: 8 })}
              />
            </Field>
            <Field label={t('auth.confirmPassword')} error={pw.formState.errors.confirm?.message} required>
              <Input
                type="password"
                dir="ltr"
                autoComplete="new-password"
                {...pw.register('confirm', { required: true })}
              />
            </Field>
            <Button type="submit" loading={pw.formState.isSubmitting}>
              {t('actions.save')}
            </Button>
          </form>
        </Card>
      </div>

      <Card title={t('auth.sessions')} className="mt-4">
        <Table head={[t('auth.lastSeen'), t('auth.ip'), t('auth.device'), '']}>
          {sessions.data?.items.map((s) => (
            <tr key={s._id}>
              <Td className="tabular">
                {formatDateTime(s.lastSeenAt)}{' '}
                {s.current && <Badge tone="brand">{t('auth.currentSession')}</Badge>}
              </Td>
              <Td className="tabular">{s.ip}</Td>
              <Td className="max-w-xs truncate text-xs text-slate-500">{s.userAgent}</Td>
              <Td>
                {!s.current && (
                  <Button variant="ghost" onClick={() => revoke.mutate(s._id)}>
                    {t('actions.revoke')}
                  </Button>
                )}
              </Td>
            </tr>
          ))}
        </Table>
      </Card>

      <Dialog
        open={!!mfaDialog}
        onClose={() => setMfaDialog(null)}
        title={mfaDialog === 'enable' ? t('auth.mfaEnable') : t('auth.mfaDisable')}
      >
        <div className="space-y-4">
          {mfaError && <Alert kind="error">{mfaError}</Alert>}
          {mfaDialog === 'enable' && enroll && (
            <div className="flex flex-col items-center gap-2">
              <img src={enroll.qrDataUrl} alt="QR" className="size-44 rounded-lg border" />
              <code dir="ltr" className="rounded bg-slate-100 px-2 py-1 text-sm">
                {enroll.manualKey}
              </code>
            </div>
          )}
          <Field label={t('auth.mfaCode')} required>
            <Input
              dir="ltr"
              inputMode="numeric"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              className="text-center tracking-[0.5em]"
            />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setMfaDialog(null)}>
              {t('actions.cancel')}
            </Button>
            <Button onClick={submitMfa} disabled={code.length !== 6}>
              {t('actions.confirm')}
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}
