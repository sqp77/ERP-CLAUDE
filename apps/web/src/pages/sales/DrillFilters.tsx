import { useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Alert, Button } from '@/shared/ui';

/**
 * Dashboard drill-downs [SAL §13 «الضغط على أي مؤشر للانتقال إلى تفاصيل البيانات»]: a card's link carries the exact
 * filter it was counted with (a date window, unpaid, latest offer per chain, one rep, one service). The list passes
 * those filters to its API and shows them in a banner with one button to clear them, so the number on the card and
 * the rows of the list always match.
 */
export type DrillKey =
  | 'createdFrom'
  | 'createdTo'
  | 'closedFrom'
  | 'closedTo'
  | 'sentFrom'
  | 'sentTo'
  | 'latest'
  | 'issuedFrom'
  | 'issuedTo'
  | 'unpaid'
  | 'ownerUserId'
  | 'serviceType';

const BOOLEAN: DrillKey[] = ['latest', 'unpaid'];

export function useDrill(keys: DrillKey[]): Record<string, string | boolean | undefined> {
  const [params] = useSearchParams();
  const out: Record<string, string | boolean | undefined> = {};
  for (const k of keys) {
    const v = params.get(k);
    if (!v) continue;
    out[k] = BOOLEAN.includes(k) ? v === 'true' : v;
  }
  return out;
}

export function DrillBanner({ keys, names }: { keys: DrillKey[]; names?: Record<string, string> }) {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const active = keys.filter((k) => params.get(k));
  if (!active.length) return null;
  const range = (from: DrillKey, to: DrillKey, label: string) => {
    const a = params.get(from);
    const b = params.get(to);
    if (!a && !b) return null;
    return t('sales.drill.range', { what: t(`sales.drill.${label}`), from: a ?? '…', to: b ?? '…' });
  };
  const parts = [
    range('createdFrom', 'createdTo', 'created'),
    range('closedFrom', 'closedTo', 'closed'),
    range('sentFrom', 'sentTo', 'sent'),
    range('issuedFrom', 'issuedTo', 'issued'),
    params.get('latest') === 'true' && active.includes('latest') ? t('sales.drill.latest') : null,
    params.get('unpaid') === 'true' && active.includes('unpaid') ? t('sales.drill.unpaid') : null,
    active.includes('ownerUserId')
      ? t('sales.drill.owner', { name: names?.[params.get('ownerUserId')!] ?? t('sales.drill.oneEmployee') })
      : null,
    active.includes('serviceType') ? t(`sales.services.${params.get('serviceType')}`) : null,
  ].filter(Boolean);
  return (
    <div className="mb-3">
      <Alert kind="info">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span>
            {t('sales.drill.prefix')} {parts.join(' · ')}
          </span>
          <Button
            variant="ghost"
            className="min-h-8 px-2 py-1"
            onClick={() => {
              const next = new URLSearchParams(params);
              for (const k of active) next.delete(k);
              setParams(next, { replace: true });
            }}
          >
            {t('sales.drill.clear')}
          </Button>
        </div>
      </Alert>
    </div>
  );
}
