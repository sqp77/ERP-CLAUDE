import ExcelJS from 'exceljs';
import type { Authz } from '../http/context';
import { badRequest } from '../http/errors';

export interface ExportField {
  key: string;
  labelAr: string;
  /** Needs field-level permission; hidden from users without it. */
  sensitive?: boolean;
  format?: (value: unknown, row: Record<string, unknown>) => unknown;
}

export interface ExportResource {
  resource: string;
  labelAr: string;
  /** Permission resource checked with action 'export'. */
  permissionResource: string;
  fields: ExportField[];
  query: (args: {
    filters: Record<string, unknown>;
    authz: Authz;
    userId: string;
    limit: number;
  }) => Promise<Record<string, unknown>[]>;
}

const registry = new Map<string, ExportResource>();
export function registerExportResource(r: ExportResource): void {
  registry.set(r.resource, r);
}
export function getExportResource(resource: string): ExportResource {
  const r = registry.get(resource);
  if (!r) throw badRequest(`مصدر تصدير غير معروف: ${resource}`);
  return r;
}
export function listExportResources() {
  return [...registry.values()].map((r) => ({
    resource: r.resource,
    labelAr: r.labelAr,
    fields: r.fields.map(({ key, labelAr, sensitive }) => ({ key, labelAr, sensitive: !!sensitive })),
  }));
}

/** Field-picker export (HR §4): only allow-listed fields, only the ones the caller may see. */
export async function buildRows(
  resource: ExportResource,
  fieldKeys: string[],
  rows: Record<string, unknown>[],
  hidden: Set<string>,
) {
  const fields = fieldKeys.map((k) => {
    const f = resource.fields.find((x) => x.key === k);
    if (!f) throw badRequest(`حقل غير مسموح: ${k}`);
    if (hidden.has(k)) throw badRequest(`ليست لديك صلاحية تصدير الحقل: ${f.labelAr}`);
    return f;
  });
  const header = fields.map((f) => f.labelAr);
  const data = rows.map((row) =>
    fields.map((f) => (f.format ? f.format(row[f.key], row) : (row[f.key] ?? ''))),
  );
  return { header, data };
}

export async function toXlsx(sheetName: string, header: string[], data: unknown[][]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheetName.slice(0, 31), { views: [{ rightToLeft: true }] });
  ws.addRow(header).font = { bold: true };
  for (const row of data)
    ws.addRow(
      row.map((v) => (v instanceof Date ? v : typeof v === 'object' && v !== null ? JSON.stringify(v) : v)),
    );
  ws.columns.forEach((c) => {
    c.width = 22;
  });
  return Buffer.from(await wb.xlsx.writeBuffer());
}
