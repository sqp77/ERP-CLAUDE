import { useEffect, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { get, patch, post } from '@/lib/api';
import { usePrefs } from '@/lib/preferences';
import { errorMessage } from '@/lib/errors';
import {
  Alert,
  Badge,
  Button,
  Card,
  Dialog,
  EmptyState,
  Field,
  Input,
  PageHeader,
  Spinner,
  Table,
  Td,
  Textarea,
  cx,
} from '@/shared/ui';
import { useToast } from '@/shared/ui/Toast';
import { FileUploader, downloadAttachment } from '@/shared/files/FileUploader';
import { sar, type EmployeeFull } from '../hr/_data';
import { statusTone } from '../hr/EmployeesPage';

interface MyProfile extends EmployeeFull {
  photoAttachmentId?: string;
  labels: {
    department?: string;
    unit?: string;
    position?: string;
    branch?: string;
    site?: string;
    directManager?: string;
  };
  currentContract: null | {
    number: string;
    type: string;
    status: string;
    startDate: string;
    endDate?: string;
    durationMonths?: number;
    attachmentId?: string;
    addenda: { titleAr: string; attachmentId?: string }[];
    probation: null | { endDate: string; inProbation: boolean };
  };
  pendingChanges: { _id: string; number: string; type: string; createdAt: string }[];
  secondment?: { destination?: string; startDate?: string; endDate?: string; reportedAt?: string };
}
interface ChangeReq {
  _id: string;
  number: string;
  type: string;
  state: 'pending' | 'approved' | 'rejected' | 'cancelled';
  bankName?: string;
  ibanLast4?: string;
  decidedAt?: string;
  decisionReason?: string;
  createdAt: string;
}

function Row({ label, value, dir }: { label: string; value?: ReactNode; dir?: 'ltr' | 'rtl' }) {
  return (
    <div className="grid grid-cols-[140px_1fr] gap-2 py-1.5 text-sm">
      <dt className="text-slate-500">{label}</dt>
      <dd dir={dir} className={cx('text-slate-900', dir === 'ltr' && 'text-start')}>
        {value || '—'}
      </dd>
    </div>
  );
}

/** Portal profile [EP §5–8]: a view on the HR record (never a copy). Edit rules per DECISIONS §10. */
export function ProfilePage() {
  const { t } = useTranslation();
  const { formatDate } = usePrefs();
  const qc = useQueryClient();
  const toast = useToast();
  const me = useQuery({ queryKey: ['me', 'profile'], queryFn: () => get<MyProfile>('/hr/me') });
  const changes = useQuery({
    queryKey: ['me', 'changes'],
    queryFn: () => get<{ items: ChangeReq[] }>('/hr/me/change-requests'),
  });
  const [photoUrl, setPhotoUrl] = useState<string>();
  useEffect(() => {
    const id = me.data?.photoAttachmentId;
    if (!id) return;
    get<{ url: string }>(`/files/${id}/url`)
      .then((r) => setPhotoUrl(r.url))
      .catch(() => undefined);
  }, [me.data?.photoAttachmentId]);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['me'] });
  };

  // contact & address edit
  const [editContact, setEditContact] = useState(false);
  const [contactError, setContactError] = useState<string>();
  const contact = useForm<Record<string, string>>();
  const saveContact = contact.handleSubmit(async (v) => {
    try {
      await patch('/hr/me/contact', {
        mobile: v.mobile || undefined,
        extension: v.extension || undefined,
        address: {
          buildingNo: v.buildingNo,
          street: v.street,
          district: v.district,
          city: v.city,
          postalCode: v.postalCode,
        },
      });
      refresh();
      toast(t('profile.saved'));
      setEditContact(false);
    } catch (e) {
      setContactError(errorMessage(e));
    }
  });

  // bank change
  const [bankOpen, setBankOpen] = useState(false);
  const [bankError, setBankError] = useState<string>();
  const [proofId, setProofId] = useState<string>();
  const bank = useForm<{ bankName: string; iban: string; notes?: string }>();
  const submitBank = bank.handleSubmit(async (v) => {
    if (!proofId) return setBankError(t('profile.proofRequired'));
    try {
      await post('/hr/me/bank-change', { ...v, proofAttachmentId: proofId });
      refresh();
      toast(t('profile.bankRequested'));
      setBankOpen(false);
      bank.reset();
      setProofId(undefined);
    } catch (e) {
      setBankError(errorMessage(e));
    }
  });
  const cancelChange = useMutation({
    mutationFn: (id: string) => post(`/hr/me/change-requests/${id}/cancel`),
    onSuccess: refresh,
  });

  // secondment report
  const [reportOpen, setReportOpen] = useState(false);
  const [reportAtt, setReportAtt] = useState<string>();
  const [reportNotes, setReportNotes] = useState('');
  const sendReport = async () => {
    if (!reportAtt) return;
    try {
      await post('/hr/me/secondment-report', { attachmentId: reportAtt, notes: reportNotes || undefined });
      refresh();
      toast(t('profile.reportSent'));
      setReportOpen(false);
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  };

  if (me.isLoading) return <Spinner />;
  if (!me.data) return <Alert kind="warning">{t('profile.noFile')}</Alert>;
  const e = me.data;
  const c = e.currentContract;
  const stateTone: Record<ChangeReq['state'], 'amber' | 'green' | 'red' | 'slate'> = {
    pending: 'amber',
    approved: 'green',
    rejected: 'red',
    cancelled: 'slate',
  };

  return (
    <>
      <PageHeader
        title={t('profile.title')}
        subtitle={`${e.employeeNumber} · ${e.labels.position ?? '—'} · ${e.labels.department ?? ''}`}
      />
      <div className="grid gap-4 lg:grid-cols-2">
        {/* 5.1 personal */}
        <Card title={t('hr.sections.personal')}>
          <div className="flex items-start gap-4">
            <div className="flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-full bg-brand-50 text-2xl font-bold text-brand-800">
              {photoUrl ? (
                <img src={photoUrl} alt="" className="size-full object-cover" />
              ) : (
                e.fullNameAr.slice(0, 1)
              )}
            </div>
            <div className="flex-1">
              <dl>
                <Row label={t('common.name')} value={e.fullNameAr} />
                <Row label={t('hr.gender')} value={t(`hr.genders.${e.gender}`)} />
                <Row label={t('hr.birthDate')} value={e.birthDate ? formatDate(e.birthDate) : undefined} />
              </dl>
              <FileUploader
                label={t('profile.changePhoto')}
                onUploaded={async (a) => {
                  await post('/hr/me/photo', { attachmentId: a.attachmentId });
                  refresh();
                }}
              />
            </div>
          </div>
        </Card>
        {/* 5.2 identity (HR-entered) */}
        <Card title={t('hr.sections.identity')}>
          <dl>
            <Row label={t('hr.nationality')} value={e.nationality} />
            <Row label={t('hr.religion')} value={e.religion} />
            <Row label={t('hr.identityType')} value={t(`hr.identityTypes.${e.identity.type}`)} />
            <Row label={t('hr.identityNumber')} value={e.identity.number} dir="ltr" />
            <Row
              label={t('hr.identityExpiry')}
              value={e.identity.expiryDate ? formatDate(e.identity.expiryDate) : undefined}
            />
          </dl>
          <p className="mt-2 text-xs text-slate-500">{t('profile.officialHint')}</p>
        </Card>
        {/* 5.3 status */}
        <Card
          title={t('profile.employmentStatus')}
          actions={
            e.status === 'seconded' && (
              <Button variant="secondary" onClick={() => setReportOpen(true)}>
                {t('profile.uploadSecondmentReport')}
              </Button>
            )
          }
        >
          <dl>
            <Row
              label={t('common.status')}
              value={<Badge tone={statusTone[e.status]}>{t(`hr.status.${e.status}`)}</Badge>}
            />
            {e.status === 'seconded' && e.secondment && (
              <>
                <Row label={t('hr.secondmentDestination')} value={e.secondment.destination} />
                <Row label={t('calendar.start')} value={formatDate(e.secondment.startDate)} />
                <Row label={t('calendar.end')} value={formatDate(e.secondment.endDate)} />
                <Row
                  label={t('profile.secondmentReport')}
                  value={
                    e.secondment.reportedAt
                      ? `${t('profile.reported')} ${formatDate(e.secondment.reportedAt)}`
                      : t('profile.notReported')
                  }
                />
              </>
            )}
            <Row
              label={t('profile.accountStatus')}
              value={<Badge tone="green">{t('common.active')}</Badge>}
            />
          </dl>
        </Card>
        {/* 5.4 / 5.5 contact + address (self-editable) */}
        <Card
          title={t('hr.sections.contact')}
          actions={
            <Button
              variant="secondary"
              onClick={() => {
                contact.reset({
                  mobile: e.mobile ?? '',
                  extension: e.extension ?? '',
                  buildingNo: e.address?.buildingNo ?? '',
                  street: e.address?.street ?? '',
                  district: e.address?.district ?? '',
                  city: e.address?.city ?? '',
                  postalCode: e.address?.postalCode ?? '',
                });
                setContactError(undefined);
                setEditContact(true);
              }}
            >
              {t('actions.edit')}
            </Button>
          }
        >
          <dl>
            <Row label={t('auth.email')} value={e.workEmail} dir="ltr" />
            <Row label={t('hr.extension')} value={e.extension} dir="ltr" />
            <Row label={t('hr.mobile')} value={e.mobile} dir="ltr" />
            <Row
              label={t('hr.address')}
              value={
                e.address
                  ? [
                      e.address.buildingNo,
                      e.address.street,
                      e.address.district,
                      e.address.city,
                      e.address.postalCode,
                    ]
                      .filter(Boolean)
                      .join('، ')
                  : undefined
              }
            />
          </dl>
          <p className="mt-2 text-xs text-slate-500">{t('profile.contactHint')}</p>
        </Card>
        {/* 6 contract */}
        <Card title={t('profile.contract')}>
          {c ? (
            <dl>
              <Row label="#" value={c.number} dir="ltr" />
              <Row label={t('hr.contractType')} value={t(`hr.contractTypes.${c.type}`)} />
              <Row
                label={t('common.status')}
                value={
                  <Badge tone={c.status === 'active' ? 'green' : 'amber'}>
                    {t(`hr.contractStatuses.${c.status}`)}
                  </Badge>
                }
              />
              <Row label={t('hr.durationMonths')} value={c.durationMonths} />
              <Row label={t('calendar.start')} value={formatDate(c.startDate)} />
              <Row
                label={t('calendar.end')}
                value={c.endDate ? formatDate(c.endDate) : t('hr.contractTypes.open_ended')}
              />
              <Row label={t('hr.hireDate')} value={formatDate(e.hireDate)} />
              <Row
                label={t('profile.probation')}
                value={
                  c.probation
                    ? c.probation.inProbation
                      ? `${t('profile.inProbation')} — ${formatDate(c.probation.endDate)}`
                      : t('profile.probationDone')
                    : undefined
                }
              />
              <Row
                label={t('files.attachment')}
                value={
                  c.attachmentId ? (
                    <Button variant="ghost" onClick={() => downloadAttachment(c.attachmentId!)}>
                      {t('files.download')}
                    </Button>
                  ) : undefined
                }
              />
              {c.addenda.length > 0 && (
                <Row
                  label={t('hr.addenda')}
                  value={c.addenda.map((a, i) => (
                    <span key={i} className="me-2">
                      {a.attachmentId ? (
                        <button
                          className="text-brand-700 hover:underline"
                          onClick={() => downloadAttachment(a.attachmentId!)}
                        >
                          {a.titleAr}
                        </button>
                      ) : (
                        a.titleAr
                      )}
                    </span>
                  ))}
                />
              )}
            </dl>
          ) : (
            <EmptyState title={t('profile.noContract')} />
          )}
        </Card>
        {/* 7 job */}
        <Card title={t('hr.sections.job')}>
          <dl>
            <Row label={t('hr.employeeNumber')} value={e.employeeNumber} dir="ltr" />
            <Row label={t('hr.position')} value={e.labels.position} />
            <Row label={t('hr.grade')} value={e.grade} />
            <Row label={t('hr.employmentType')} value={t(`hr.employmentTypes.${e.employmentType}`)} />
            <Row label={t('admin.users.department')} value={e.labels.department} />
            <Row label={t('hr.unit')} value={e.labels.unit} />
            <Row label={t('hr.directManager')} value={e.labels.directManager} />
            <Row
              label={t('admin.org.branch')}
              value={[e.labels.branch, e.labels.site].filter(Boolean).join(' — ')}
            />
            <Row label={t('hr.hireDate')} value={formatDate(e.hireDate)} />
            <Row label={t('hr.endDate')} value={e.endDate ? formatDate(e.endDate) : undefined} />
          </dl>
        </Card>
        {/* 8 financial (read-only) */}
        <Card title={t('hr.sections.financial')}>
          <dl>
            <Row label={t('hr.basicSalary')} value={sar(e.basicSalaryHalalas)} />
            <Row
              label={t('hr.allowances')}
              value={
                e.allowances?.length ? (
                  <ul>
                    {e.allowances.map((a, i) => (
                      <li key={i}>
                        {a.type}: {sar(a.amountHalalas)}
                      </li>
                    ))}
                  </ul>
                ) : undefined
              }
            />
            <Row label={t('profile.advances')} value={t('profile.noAdvances')} />
          </dl>
          <p className="mt-2 text-xs text-slate-500">{t('profile.financialHint')}</p>
        </Card>
        {/* 8.1 bank */}
        <Card
          title={t('profile.bank')}
          actions={
            <Button
              variant="secondary"
              disabled={e.pendingChanges.some((p) => p.type === 'bank')}
              onClick={() => {
                setBankError(undefined);
                setBankOpen(true);
              }}
            >
              {t('profile.requestBankChange')}
            </Button>
          }
        >
          <dl>
            <Row label={t('hr.bank')} value={e.bank?.bankName} />
            <Row label="IBAN" value={e.bank?.iban} dir="ltr" />
          </dl>
          {changes.data?.items.length ? (
            <Table head={['#', t('hr.bank'), t('common.status'), t('common.date'), '']}>
              {changes.data.items.map((r) => (
                <tr key={r._id}>
                  <Td className="tabular text-xs">{r.number}</Td>
                  <Td>
                    {r.bankName}{' '}
                    <span className="text-xs text-slate-500" dir="ltr">
                      ••••{r.ibanLast4}
                    </span>
                  </Td>
                  <Td>
                    <Badge tone={stateTone[r.state]}>{t(`profile.changeStates.${r.state}`)}</Badge>
                    {r.decisionReason && <div className="text-xs text-slate-500">{r.decisionReason}</div>}
                  </Td>
                  <Td className="tabular text-xs">{formatDate(r.decidedAt ?? r.createdAt)}</Td>
                  <Td>
                    {r.state === 'pending' && (
                      <Button variant="ghost" onClick={() => cancelChange.mutate(r._id)}>
                        {t('actions.cancel')}
                      </Button>
                    )}
                  </Td>
                </tr>
              ))}
            </Table>
          ) : null}
          <p className="mt-2 text-xs text-slate-500">{t('profile.bankHint')}</p>
        </Card>
      </div>

      <Dialog open={editContact} onClose={() => setEditContact(false)} title={t('hr.sections.contact')}>
        <form onSubmit={saveContact} className="space-y-3" noValidate>
          {contactError && <Alert kind="error">{contactError}</Alert>}
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('hr.mobile')}>
              <Input dir="ltr" inputMode="tel" placeholder="+9665xxxxxxxx" {...contact.register('mobile')} />
            </Field>
            <Field label={t('hr.extension')}>
              <Input dir="ltr" {...contact.register('extension')} />
            </Field>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Field label={t('hr.addressFields.buildingNo')}>
              <Input dir="ltr" {...contact.register('buildingNo')} />
            </Field>
            <Field label={t('hr.addressFields.street')}>
              <Input {...contact.register('street')} />
            </Field>
            <Field label={t('hr.addressFields.district')}>
              <Input {...contact.register('district')} />
            </Field>
            <Field label={t('hr.addressFields.city')}>
              <Input {...contact.register('city')} />
            </Field>
            <Field label={t('hr.addressFields.postalCode')}>
              <Input dir="ltr" {...contact.register('postalCode')} />
            </Field>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setEditContact(false)}>
              {t('actions.cancel')}
            </Button>
            <Button type="submit" loading={contact.formState.isSubmitting}>
              {t('actions.save')}
            </Button>
          </div>
        </form>
      </Dialog>

      <Dialog open={bankOpen} onClose={() => setBankOpen(false)} title={t('profile.requestBankChange')}>
        <form onSubmit={submitBank} className="space-y-3" noValidate>
          <Alert kind="info">{t('profile.bankHint')}</Alert>
          {bankError && <Alert kind="error">{bankError}</Alert>}
          <Field label={t('hr.bank')} required>
            <Input {...bank.register('bankName', { required: true })} />
          </Field>
          <Field label="IBAN" required>
            <Input dir="ltr" placeholder="SA…" {...bank.register('iban', { required: true })} />
          </Field>
          <Field label={t('profile.proof')} required>
            <FileUploader sensitive onUploaded={(a) => setProofId(a.attachmentId)} />
          </Field>
          <Field label={t('hr.notes')}>
            <Textarea rows={2} {...bank.register('notes')} />
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setBankOpen(false)}>
              {t('actions.cancel')}
            </Button>
            <Button type="submit" loading={bank.formState.isSubmitting}>
              {t('actions.send')}
            </Button>
          </div>
        </form>
      </Dialog>

      <Dialog
        open={reportOpen}
        onClose={() => setReportOpen(false)}
        title={t('profile.uploadSecondmentReport')}
      >
        <div className="space-y-3">
          <Field label={t('files.attachment')} required>
            <FileUploader onUploaded={(a) => setReportAtt(a.attachmentId)} />
          </Field>
          <Field label={t('hr.notes')}>
            <Textarea rows={3} value={reportNotes} onChange={(ev) => setReportNotes(ev.target.value)} />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setReportOpen(false)}>
              {t('actions.cancel')}
            </Button>
            <Button onClick={sendReport} disabled={!reportAtt}>
              {t('actions.send')}
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}
