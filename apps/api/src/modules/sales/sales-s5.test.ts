import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { SALES_REPORTS } from '@eayni/shared';
import { auth, loginAs, makeUser, testApp } from '../../test/helpers';
import { setup, soldAndInvoiced } from '../../test/salesFixtures';
import { AuditLog } from '../../core/audit/model';
import { collectRoutes } from '../../core/openapi/service';
import { periodDays } from '../../core/kpi/service';

const app = () => testApp();
const R = (code: string) => `sales.report.${code}`;
const binary = (r: request.Test) =>
  r.buffer(true).parse((res, cb) => {
    const chunks: Buffer[] = [];
    res.on('data', (c) => chunks.push(c));
    res.on('end', () => cb(null, Buffer.concat(chunks)));
  });

describe('Sales S5 — reports and the API document [SAL §12, §18 (16), §18 (20)]', () => {
  it('reports: the manager and the executive get the thirteen reports, reps and other departments none; figures come from Finance invoices', async () => {
    const ctx = await setup();
    const { t, u } = ctx;
    const { invoice, period } = await soldAndInvoiced(ctx, { tons: 2, externalNumber: 'INV-S5-1' });
    const { from, to } = periodDays(period);

    const list = async (who: keyof typeof t) =>
      request(app()).get('/api/v1/export/resources').set(auth(t[who]));
    const mgr = await list('mgr');
    expect(mgr.status).toBe(200);
    const mine = mgr.body.items.filter((r: { resource: string }) => r.resource.startsWith('sales.report.'));
    expect(mine.map((r: { resource: string }) => r.resource).sort()).toEqual(
      SALES_REPORTS.map((r) => R(r.code)).sort(),
    );
    expect(mine[0].scope).toBe('department');
    const ceo = (await list('ceo')).body.items.filter((r: { resource: string }) =>
      r.resource.startsWith('sales.report.'),
    );
    expect(ceo).toHaveLength(SALES_REPORTS.length);
    expect(ceo[0].scope).toBe('all');
    // A rep has no export right; the Finance manager exports Finance resources, not Sales reports.
    expect((await list('reem')).status).toBe(403);
    const fin = await list('abdulaziz');
    if (fin.status === 200)
      expect(fin.body.items.some((r: { resource: string }) => r.resource.startsWith('sales.report.'))).toBe(
        false,
      );
    const asFinance = await request(app())
      .post('/api/v1/export')
      .set(auth(t.abdulaziz))
      .send({ resource: R('invoices'), fields: ['number'], format: 'preview' });
    expect(asFinance.status).toBe(403);

    // Sales by period: one invoice, revenue before VAT in riyals, tons from the invoice lines.
    const byDay = await request(app())
      .post('/api/v1/export')
      .set(auth(t.mgr))
      .send({
        resource: R('sales_by_period'),
        fields: ['period', 'invoices', 'subtotal', 'vat', 'total', 'kg'],
        filters: { from, to, granularity: 'month' },
        format: 'preview',
      });
    expect(byDay.status, JSON.stringify(byDay.body)).toBe(200);
    expect(byDay.body.rows).toEqual([
      [
        period,
        1,
        invoice.subtotalHalalas / 100,
        invoice.vatTotalHalalas / 100,
        invoice.totalHalalas / 100,
        2,
      ],
    ]);
    expect(byDay.body.columns[2].kind).toBe('money');

    // Material, service, quantities and average prices.
    const material = await request(app())
      .post('/api/v1/export')
      .set(auth(t.mgr))
      .send({
        resource: R('revenue_by_material'),
        fields: ['material', 'kg', 'revenue', 'shareBp'],
        filters: { from, to },
        format: 'preview',
      });
    expect(material.body.rows).toEqual([['كرتون', 2, 120_000, 100]]);
    const prices = await request(app())
      .post('/api/v1/export')
      .set(auth(t.mgr))
      .send({
        resource: R('avg_prices'),
        fields: ['material', 'avgPerTon'],
        filters: { from, to },
        format: 'preview',
      });
    expect(prices.body.rows).toEqual([['كرتون', 60_000]]);

    // The employee filter: majed sold nothing.
    const majed = await request(app())
      .post('/api/v1/export')
      .set(auth(t.mgr))
      .send({
        resource: R('sales_by_period'),
        fields: ['period'],
        filters: { from, to, ownerUserId: String(u.majed._id) },
        format: 'preview',
      });
    expect(majed.body.total).toBe(0);

    // Employees: reem's achieved sales and the quote she sent.
    const emp = await request(app())
      .post('/api/v1/export')
      .set(auth(t.mgr))
      .send({
        resource: R('employees'),
        fields: ['employee', 'quotesSent', 'achieved', 'customersRegistered'],
        filters: { from, to },
        format: 'preview',
      });
    expect(emp.status).toBe(200);
    const reemRow = emp.body.rows.find((r: unknown[]) => r[0] === 'reem');
    expect(reemRow).toEqual(['reem', 1, 120_000, 1]);

    // Customers: the database and the new ones; quotes accepted; an unpaid invoice; the financial summary.
    const customers = await request(app())
      .post('/api/v1/export')
      .set(auth(t.mgr))
      .send({
        resource: R('customers'),
        fields: ['nameAr', 'status', 'owner'],
        filters: { from, to, segment: 'new' },
        format: 'preview',
      });
    expect(customers.body.rows).toEqual([['شركة الخليج للتغليف', 'عميل محتمل', 'reem']]);
    const quotes = await request(app())
      .post('/api/v1/export')
      .set(auth(t.mgr))
      .send({
        resource: R('quotes'),
        fields: ['number', 'state'],
        filters: { from, to, segment: 'accepted' },
        format: 'preview',
      });
    expect(quotes.body.total).toBe(1);
    const unpaid = await request(app())
      .post('/api/v1/export')
      .set(auth(t.mgr))
      .send({
        resource: R('invoices'),
        fields: ['externalNumber', 'remaining', 'state'],
        filters: { from, to, segment: 'unpaid' },
        format: 'preview',
      });
    expect(unpaid.body.rows).toEqual([['INV-S5-1', invoice.totalHalalas / 100, 'مستحق']]);
    const summary = await request(app())
      .post('/api/v1/export')
      .set(auth(t.ceo))
      .send({
        resource: R('financial_summary'),
        fields: ['invoices', 'unpaid', 'outstanding'],
        filters: { from, to },
        format: 'preview',
      });
    expect(summary.body.rows).toEqual([[1, 1, invoice.totalHalalas / 100]]);

    // Bad filters and unknown fields are refused; Excel and PDF work; every export is audited.
    expect(
      (
        await request(app())
          .post('/api/v1/export')
          .set(auth(t.mgr))
          .send({
            resource: R('customers'),
            fields: ['nameAr'],
            filters: { from: '2026-13-01' },
            format: 'preview',
          })
      ).status,
    ).toBe(400);
    expect(
      (
        await request(app())
          .post('/api/v1/export')
          .set(auth(t.mgr))
          .send({ resource: R('customers'), fields: ['passwordHash'], format: 'preview' })
      ).status,
    ).toBe(400);
    const xlsx = await binary(
      request(app())
        .post('/api/v1/export')
        .set(auth(t.mgr))
        .send({
          resource: R('revenue_by_service'),
          fields: ['service', 'subtotal'],
          filters: { from, to },
          format: 'xlsx',
        }),
    );
    expect(xlsx.status).toBe(200);
    expect((xlsx.body as Buffer).subarray(0, 2).toString()).toBe('PK');
    const pdf = await request(app())
      .post('/api/v1/export')
      .set(auth(t.mgr))
      .send({
        resource: R('loss_reasons'),
        fields: ['reason', 'count'],
        filters: { from, to },
        format: 'pdf',
      });
    expect(pdf.status).toBe(200);
    expect(pdf.text).toContain('أسباب خسارة الفرص');
    expect(pdf.text).toContain(`الفترة: ${from}`);
    expect(pdf.text).not.toContain('<script');
    // 11 successful exports; the refused ones (bad filters, unknown field, no permission) wrote nothing.
    expect(await AuditLog.countDocuments({ action: 'export', resource: 'sales.reports' })).toBe(11);
  });

  it('API document: every Sales, CRM, invoice and discussion route is listed with its permission; admin and executive only', async () => {
    const { t } = await setup();
    await makeUser('it-admin@eayni.local', [{ role: 'employee' }, { role: 'system_admin' }]);
    const admin = await loginAs('it-admin@eayni.local');
    expect((await request(app()).get('/api/v1/openapi.json').set(auth(t.reem))).status).toBe(403);
    expect((await request(app()).get('/api/v1/openapi.json')).status).toBe(401);
    const doc = await request(app()).get('/api/v1/openapi.json').set(auth(admin));
    expect(doc.status).toBe(200);
    expect(doc.body.openapi).toBe('3.0.3');
    const routes = collectRoutes(app()).filter((r) =>
      /^\/api\/v1\/(sales|crm|finance\/invoices|discussions|calendar|parties|tags)(\/|$)/.test(r.path),
    );
    expect(routes.length).toBeGreaterThan(80);
    for (const r of routes) {
      const path = r.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
      expect(doc.body.paths[path]?.[r.method], `${r.method} ${r.path}`).toBeDefined();
    }
    const targets = doc.body.paths['/api/v1/sales/management/targets'];
    expect(targets.post['x-permission']).toBe('sales.targets:edit');
    expect(targets.post.requestBody.content['application/json'].schema.properties.reason).toBeDefined();
    expect(targets.get.parameters.map((p: { name: string }) => p.name)).toContain('period');
    // The executive reads it too; the HTML viewer is inert and can be narrowed to Sales.
    expect((await request(app()).get('/api/v1/openapi.json').set(auth(t.ceo))).status).toBe(200);
    const html = await request(app()).get('/api/v1/docs?prefix=/api/v1/sales').set(auth(admin));
    expect(html.status).toBe(200);
    expect(html.text).toContain('/api/v1/sales/quotes');
    expect(html.text).not.toContain('/api/v1/users');
    expect(html.text).not.toContain('<script');
  });
});
