import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { PRICE_UNITS } from '@eayni/shared';
import { patch, post } from '@/lib/api';
import { localInputToIso } from '@/lib/dates';
import { errorMessage } from '@/lib/errors';
import { usePrefs } from '@/lib/preferences';
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
  QueryError,
  Select,
  Spinner,
  Table,
  Td,
} from '@/shared/ui';
import { useToast } from '@/shared/ui/Toast';
import { sar } from '../../hr/_data';
import { usePriceHistory, usePriceList, type PriceItemRow } from './_data';

/** قائمة الأسعار المركزية ومصفوفة الخصم [SAL §7.1, §7.2]: append-only prices with valid-from, weekly market prices, editor roles. */
export function PriceListPage() {
  const { t } = useTranslation();
  const { formatDate } = usePrefs();
  const toast = useToast();
  const qc = useQueryClient();
  const [showInactive, setShowInactive] = useState(false);
  const q = usePriceList(showInactive);
  const [newOpen, setNewOpen] = useState(false);
  const [priceFor, setPriceFor] = useState<PriceItemRow | null>(null);
  const [marketFor, setMarketFor] = useState<PriceItemRow | null>(null);
  const [historyFor, setHistoryFor] = useState<PriceItemRow | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['sales', 'pricelist'] });
  const toggle = useMutation({
    mutationFn: (x: PriceItemRow) => patch(`/sales/pricelist/items/${x._id}`, { active: !x.active }),
    onSuccess: refresh,
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const m = q.data?.matrix;
  return (
    <>
      <PageHeader
        title={t('sales.pricelist.title')}
        subtitle={t('sales.pricelist.subtitle')}
        actions={
          q.data?.canEdit ? (
            <Button onClick={() => setNewOpen(true)}>{t('sales.pricelist.addItem')}</Button>
          ) : undefined
        }
      />
      {m && (
        <Card title={t('sales.pricelist.matrixTitle')} className="mb-3">
          {m.limitsUnset ? (
            <Alert kind="warning">{t('sales.pricelist.limitsUnset')}</Alert>
          ) : (
            <p className="text-sm text-slate-700">
              {t('sales.pricelist.limits', {
                rep: (m.limits.rep! / 100).toFixed(1),
                manager: (m.limits.manager! / 100).toFixed(1),
              })}
            </p>
          )}
          <p className="mt-1 text-xs text-slate-500">
            {t(`sales.pricelist.modes.${m.mode}`)} · {t('sales.pricelist.matrixHint')}
          </p>
        </Card>
      )}
      <label className="mb-2 flex items-center gap-2 text-sm">
        <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />{' '}
        {t('sales.pricelist.showInactive')}
      </label>
      <Card>
        {q.isError ? (
          <QueryError error={q.error} onRetry={() => q.refetch()} />
        ) : q.isLoading ? (
          <Spinner />
        ) : !q.data?.items.length ? (
          <EmptyState title={t('sales.pricelist.empty')} hint={t('sales.pricelist.emptyHint')} />
        ) : (
          <Table
            head={[
              t('sales.pricelist.item'),
              t('sales.pricelist.kind'),
              t('sales.pricelist.category'),
              t('sales.pricelist.unit'),
              t('sales.pricelist.price'),
              t('sales.pricelist.validFrom'),
              t('sales.pricelist.market'),
              t('common.actions'),
            ]}
          >
            {q.data.items.map((x) => (
              <tr key={x._id} className={x.active ? '' : 'opacity-60'}>
                <Td className="font-medium">
                  <button type="button" className="hover:underline" onClick={() => setHistoryFor(x)}>
                    {x.nameAr}
                  </button>
                </Td>
                <Td>{t(`sales.pricelist.kinds.${x.kind}`)}</Td>
                <Td>{x.category ?? '—'}</Td>
                <Td>{t(`sales.pricelist.units.${x.unit}`)}</Td>
                <Td className="tabular">
                  {x.priceHalalas != null ? (
                    sar(x.priceHalalas)
                  ) : (
                    <Badge tone="amber">{t('sales.pricelist.noPrice')}</Badge>
                  )}
                </Td>
                <Td className="tabular">{x.validFrom ? formatDate(x.validFrom) : '—'}</Td>
                <Td className="tabular">
                  {x.marketPriceHalalas != null ? `${sar(x.marketPriceHalalas)} (${x.marketWeekOf})` : '—'}
                </Td>
                <Td>
                  {q.data!.canEdit && (
                    <span className="flex flex-wrap gap-1">
                      <Button variant="secondary" onClick={() => setPriceFor(x)}>
                        {t('sales.pricelist.newPrice')}
                      </Button>
                      <Button variant="secondary" onClick={() => setMarketFor(x)}>
                        {t('sales.pricelist.newMarket')}
                      </Button>
                      <Button variant="secondary" onClick={() => toggle.mutate(x)}>
                        {x.active ? t('sales.pricelist.deactivate') : t('sales.pricelist.activate')}
                      </Button>
                    </span>
                  )}
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      <NewItemDialog open={newOpen} onClose={() => setNewOpen(false)} onDone={refresh} />
      <NewPriceDialog item={priceFor} market={false} onClose={() => setPriceFor(null)} onDone={refresh} />
      <NewPriceDialog item={marketFor} market onClose={() => setMarketFor(null)} onDone={refresh} />
      <HistoryDialog item={historyFor} onClose={() => setHistoryFor(null)} />
    </>
  );
}

function NewItemDialog({
  open,
  onClose,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const [v, setV] = useState({
    kind: 'material',
    nameAr: '',
    category: '',
    unit: 'ton',
    price: '',
    validFrom: '',
  });
  const [error, setError] = useState<string>();
  const m = useMutation({
    mutationFn: () =>
      post('/sales/pricelist/items', {
        kind: v.kind,
        nameAr: v.nameAr,
        category: v.category || undefined,
        unit: v.unit,
        priceHalalas: v.price ? Math.round(Number(v.price) * 100) : undefined,
        validFrom: localInputToIso(v.validFrom),
      }),
    onSuccess: () => {
      toast(t('actions.save'));
      setV({ kind: 'material', nameAr: '', category: '', unit: 'ton', price: '', validFrom: '' });
      onDone();
      onClose();
    },
    onError: (e) => setError(errorMessage(e)),
  });
  return (
    <Dialog open={open} onClose={onClose} title={t('sales.pricelist.addItem')}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          m.mutate();
        }}
      >
        {error && <Alert kind="error">{error}</Alert>}
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('sales.pricelist.kind')}>
            <Select value={v.kind} onChange={(e) => setV({ ...v, kind: e.target.value })}>
              <option value="material">{t('sales.pricelist.kinds.material')}</option>
              <option value="service">{t('sales.pricelist.kinds.service')}</option>
            </Select>
          </Field>
          <Field label={t('sales.pricelist.unit')}>
            <Select value={v.unit} onChange={(e) => setV({ ...v, unit: e.target.value })}>
              {PRICE_UNITS.map((u) => (
                <option key={u} value={u}>
                  {t(`sales.pricelist.units.${u}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('sales.pricelist.item')} required>
            <Input
              value={v.nameAr}
              onChange={(e) => setV({ ...v, nameAr: e.target.value })}
              required
              minLength={2}
            />
          </Field>
          <Field label={t('sales.pricelist.category')}>
            <Input value={v.category} onChange={(e) => setV({ ...v, category: e.target.value })} />
          </Field>
          <Field label={t('sales.pricelist.priceSar')}>
            <Input
              type="number"
              min={0}
              step="0.01"
              dir="ltr"
              value={v.price}
              onChange={(e) => setV({ ...v, price: e.target.value })}
            />
          </Field>
          <Field label={t('sales.pricelist.validFrom')}>
            <Input
              type="datetime-local"
              dir="ltr"
              value={v.validFrom}
              onChange={(e) => setV({ ...v, validFrom: e.target.value })}
            />
          </Field>
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('actions.cancel')}
          </Button>
          <Button type="submit" loading={m.isPending}>
            {t('actions.save')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function NewPriceDialog({
  item,
  market,
  onClose,
  onDone,
}: {
  item: PriceItemRow | null;
  market: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const [price, setPrice] = useState('');
  const [validFrom, setValidFrom] = useState('');
  const [source, setSource] = useState('');
  const [error, setError] = useState<string>();
  const m = useMutation({
    mutationFn: () =>
      market
        ? post(`/sales/pricelist/items/${item!._id}/market`, {
            priceHalalas: Math.round(Number(price) * 100),
            source: source || undefined,
          })
        : post(`/sales/pricelist/items/${item!._id}/prices`, {
            priceHalalas: Math.round(Number(price) * 100),
            validFrom: localInputToIso(validFrom),
            note: source || undefined,
          }),
    onSuccess: () => {
      toast(t('actions.save'));
      setPrice('');
      setValidFrom('');
      setSource('');
      onDone();
      onClose();
    },
    onError: (e) => setError(errorMessage(e)),
  });
  if (!item) return null;
  return (
    <Dialog
      open
      onClose={onClose}
      title={`${market ? t('sales.pricelist.newMarket') : t('sales.pricelist.newPrice')} — ${item.nameAr}`}
    >
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (price) m.mutate();
        }}
      >
        {error && <Alert kind="error">{error}</Alert>}
        <Field label={t('sales.pricelist.priceSar')} required>
          <Input
            type="number"
            min={0}
            step="0.01"
            dir="ltr"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            required
          />
        </Field>
        {!market && (
          <Field label={t('sales.pricelist.validFrom')} hint={t('sales.pricelist.validFromHint')}>
            <Input
              type="datetime-local"
              dir="ltr"
              value={validFrom}
              onChange={(e) => setValidFrom(e.target.value)}
            />
          </Field>
        )}
        <Field label={market ? t('sales.pricelist.marketSource') : t('sales.requests.note')}>
          <Input value={source} onChange={(e) => setSource(e.target.value)} />
        </Field>
        <p className="text-xs text-slate-500">{t('sales.pricelist.appendOnlyHint')}</p>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('actions.cancel')}
          </Button>
          <Button type="submit" loading={m.isPending}>
            {t('actions.save')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function HistoryDialog({ item, onClose }: { item: PriceItemRow | null; onClose: () => void }) {
  const { t } = useTranslation();
  const { formatDateTime } = usePrefs();
  const q = usePriceHistory(item?._id ?? null);
  if (!item) return null;
  return (
    <Dialog open onClose={onClose} title={`${t('sales.pricelist.history')} — ${item.nameAr}`}>
      {q.isLoading ? (
        <Spinner />
      ) : (
        <div className="space-y-3 text-sm">
          <div>
            <div className="mb-1 font-semibold">{t('sales.pricelist.priceEntries')}</div>
            <ul className="divide-y divide-slate-100">
              {q.data?.entries.map((e) => (
                <li key={e._id} className="flex justify-between py-1.5">
                  <span className="tabular">
                    {sar(e.priceHalalas)} · {t('sales.pricelist.validFrom')} {formatDateTime(e.validFrom)}
                  </span>
                  <span className="text-xs text-slate-500">
                    {e.byEmail} · {formatDateTime(e.at)}
                    {e.note && ` · ${e.note}`}
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <div className="mb-1 font-semibold">{t('sales.pricelist.marketEntries')}</div>
            {!q.data?.market.length ? (
              <p className="text-slate-500">{t('common.empty')}</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {q.data.market.map((mk) => (
                  <li key={mk._id} className="flex justify-between py-1.5">
                    <span className="tabular">
                      {mk.weekOf}: {sar(mk.priceHalalas)}
                    </span>
                    <span className="text-xs text-slate-500">{mk.source ?? mk.byEmail}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </Dialog>
  );
}
