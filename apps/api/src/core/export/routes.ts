import { Router } from 'express';
import type { z } from 'zod';
import { exportRequestSchema, type RoleAssignment } from '@eayni/shared';
import { asyncHandler } from '../http/async';
import { validate } from '../http/validate';
import { actorFrom, type AuthedRequest } from '../http/context';
import { forbidden } from '../http/errors';
import { requireAuth } from '../auth/middleware';
import { authorize } from '../rbac/authorize';
import { effectivePermission, fieldRestrictions } from '../rbac/service';
import { recordAudit } from '../audit/service';
import { escapeHtml, htmlDocument, sendHtml } from '../templates/render';
import { buildRows, getExportResource, listExportResources, toXlsx } from './service';

export const exportRouter = Router();

exportRouter.get(
  '/resources',
  requireAuth(),
  authorize('exports', 'view'),
  asyncHandler(async (req: AuthedRequest, res) => {
    // Only resources the caller may export, and only the fields they may see [HR §4, HR §6].
    const user = req.auth.user;
    const items = [];
    for (const r of listExportResources()) {
      const def = getExportResource(r.resource);
      const eff = await effectivePermission(
        user.roles as RoleAssignment[],
        user.departmentId ? String(user.departmentId) : undefined,
        def.permissionResource,
        'export',
        String(user._id),
      );
      if (!eff) continue;
      const { hidden } = await fieldRestrictions(user.roles as RoleAssignment[], def.permissionResource);
      items.push({ ...r, scope: eff.scope, fields: r.fields.filter((f) => !hidden.has(f.key)) });
    }
    res.json({ items });
  }),
);

exportRouter.post(
  '/',
  requireAuth(),
  authorize('exports', 'create'),
  validate(exportRequestSchema),
  asyncHandler(async (req: AuthedRequest, res) => {
    const body = req.body as z.infer<typeof exportRequestSchema>;
    const resource = getExportResource(body.resource);
    const user = req.auth.user;
    const eff = await effectivePermission(
      user.roles as RoleAssignment[],
      user.departmentId ? String(user.departmentId) : undefined,
      resource.permissionResource,
      'export',
      String(user._id),
    );
    if (!eff) throw forbidden('ليست لديك صلاحية تصدير هذا المصدر');
    const { hidden } = await fieldRestrictions(user.roles as RoleAssignment[], resource.permissionResource);
    const rows = await resource.query({
      filters: body.filters,
      authz: { resource: resource.permissionResource, action: 'export', ...eff },
      userId: String(user._id),
      limit: body.limit,
    });
    const { header, columns, data } = await buildRows(resource, body.fields, rows, hidden);
    const sensitiveFields = body.fields.filter((k) => resource.fields.find((f) => f.key === k)?.sensitive);
    await recordAudit(actorFrom(req), {
      action: 'export',
      resource: resource.permissionResource,
      sensitive: sensitiveFields.length > 0,
      meta: {
        fields: body.fields,
        sensitiveFields,
        filters: body.filters,
        rows: data.length,
        format: body.format,
      },
    });

    if (body.format === 'preview')
      return res.json({ header, columns, rows: data.slice(0, 50), total: data.length });
    if (body.format === 'xlsx') {
      const buf = await toXlsx(resource.labelAr, header, data);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename*=UTF-8''${encodeURIComponent(resource.resource)}.xlsx`,
      );
      return res.send(buf);
    }
    // PDF: until the Chromium renderer is configured we return printable HTML (the browser prints it). Every value is escaped (review E10).
    const cell = (v: unknown) =>
      escapeHtml(v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? ''));
    const table = `<h2>${escapeHtml(resource.labelAr)}</h2><table><thead><tr>${header.map((h) => `<th>${escapeHtml(h)}</th>`).join('')}</tr></thead><tbody>${data
      .map((r) => `<tr>${r.map((v) => `<td>${cell(v)}</td>`).join('')}</tr>`)
      .join('')}</tbody></table>`;
    sendHtml(res, htmlDocument(table, resource.labelAr));
  }),
);
