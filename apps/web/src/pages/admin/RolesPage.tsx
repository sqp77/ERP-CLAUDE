import { useTranslation } from 'react-i18next';
import { Badge, Card, PageHeader, Spinner, QueryError } from '@/shared/ui';
import { useRoles } from './_shared';

/** Read-only view of the permission matrix (resource × action × scope). Editing arrives with the HR admin screens. */
export function RolesPage() {
  const { t } = useTranslation();
  const roles = useRoles();
  return (
    <>
      <PageHeader title={t('admin.roles.title')} />
      {roles.isError ? (
        <QueryError error={roles.error} onRetry={() => roles.refetch()} />
      ) : roles.isLoading ? (
        <Spinner />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {roles.data?.items.map((r) => (
            <Card
              key={r.code}
              title={
                <span>
                  {r.nameAr} <code className="ms-2 text-xs text-slate-400">{r.code}</code>
                </span>
              }
              actions={r.system && <Badge>{t('admin.roles.system')}</Badge>}
            >
              {r.grants.length === 0 ? (
                <p className="text-sm text-slate-500">{t('common.empty')}</p>
              ) : (
                <ul className="space-y-1 text-sm">
                  {r.grants.map((g, i) => (
                    <li
                      key={i}
                      className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 py-1 last:border-0"
                    >
                      <code className="text-xs text-slate-700">{g.resource}</code>
                      <span className="flex flex-wrap gap-1">
                        {g.actions.map((a) => (
                          <Badge key={a} tone="blue">
                            {a}
                          </Badge>
                        ))}
                        <Badge tone="brand">{t(`admin.roles.scopes.${g.scope}`)}</Badge>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
