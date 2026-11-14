import { Router, type Express } from 'express';
import { asyncHandler } from '../http/async';
import { requireAuth } from '../auth/middleware';
import { authorize } from '../rbac/authorize';
import { escapeHtml, htmlDocument, sendHtml } from '../templates/render';
import { buildOpenApi } from './service';

/**
 * `GET /api/v1/openapi.json` and `GET /api/v1/docs` [SAL §18 (20)]: the API document of the running app and a static,
 * script-free HTML viewer of it (go-live review E10: every HTML we serve is inert). `?prefix=/api/v1/sales` narrows it.
 */
export function openApiRouter(app: Express): Router {
  const r = Router();
  let cached: ReturnType<typeof buildOpenApi> | null = null;
  const doc = (prefix?: string) => {
    if (prefix) return buildOpenApi(app, { prefix });
    cached ??= buildOpenApi(app);
    return cached;
  };
  const prefixOf = (q: unknown) =>
    typeof q === 'string' && /^\/api\/v1(\/[a-z0-9_-]+)*$/.test(q) ? q : undefined;

  r.get(
    '/openapi.json',
    requireAuth(),
    authorize('api.docs', 'view'),
    asyncHandler(async (req, res) => {
      res.json(doc(prefixOf(req.query.prefix)));
    }),
  );
  r.get(
    '/docs',
    requireAuth(),
    authorize('api.docs', 'view'),
    asyncHandler(async (req, res) => {
      const d = doc(prefixOf(req.query.prefix));
      const byTag = new Map<string, { method: string; path: string; op: Record<string, unknown> }[]>();
      for (const [path, ops] of Object.entries(d.paths))
        for (const [method, op] of Object.entries(ops as Record<string, Record<string, unknown>>)) {
          const tag = (op.tags as string[])[0];
          if (!byTag.has(tag)) byTag.set(tag, []);
          byTag.get(tag)!.push({ method, path, op });
        }
      const section = [...byTag.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([tag, ops]) => {
          const rows = ops
            .map(({ method, path, op }) => {
              const params = ((op.parameters as { name: string; in: string; required?: boolean }[]) ?? [])
                .map(
                  (p) => `${escapeHtml(p.name)}${p.required ? '*' : ''} <small>(${escapeHtml(p.in)})</small>`,
                )
                .join('، ');
              const body = op.requestBody
                ? escapeHtml(
                    Object.keys(
                      ((op.requestBody as { content: Record<string, { schema: { properties?: object } }> })
                        .content['application/json'].schema.properties ?? {}) as object,
                    ).join('، '),
                  )
                : '';
              return `<tr><td dir="ltr"><b>${escapeHtml(method.toUpperCase())}</b></td><td dir="ltr"><code>${escapeHtml(path)}</code></td><td dir="ltr"><code>${escapeHtml(String(op['x-permission'] ?? ''))}</code></td><td>${params}</td><td dir="ltr">${body}</td></tr>`;
            })
            .join('');
          return `<h2 dir="ltr">${escapeHtml(tag)}</h2><table><thead><tr><th>الطريقة</th><th>المسار</th><th>الصلاحية</th><th>المعاملات</th><th>حقول الطلب</th></tr></thead><tbody>${rows}</tbody></table>`;
        })
        .join('');
      const count = Object.values(d.paths).reduce((a, ops) => a + Object.keys(ops).length, 0);
      sendHtml(
        res,
        htmlDocument(
          `<h1>${escapeHtml(d.info.title)}</h1><p>${escapeHtml(d.info.description)}</p><p>${count} واجهة · <a href="openapi.json${req.query.prefix ? `?prefix=${encodeURIComponent(String(req.query.prefix))}` : ''}">openapi.json</a></p>${section}`,
          d.info.title,
        ),
      );
    }),
  );
  return r;
}
