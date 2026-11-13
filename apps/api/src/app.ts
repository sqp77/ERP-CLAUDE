import express, { type Express } from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { env } from './config';
import { requireCloudFrontOrigin } from './core/http/origin';
import { logger } from './logger';
import { errorHandler, notFoundHandler } from './core/http/errors';
import { authRouter } from './core/auth/routes';
import { usersRouter } from './core/auth/usersRoutes';
import { rolesRouter } from './core/rbac/routes';
import { settingsRouter } from './core/settings/routes';
import { auditRouter } from './core/audit/routes';
import { outboxRouter } from './core/outbox/routes';
import { orgRouter } from './core/org/routes';
import { holidaysRouter } from './core/dates/routes';
import { workflowsRouter } from './core/workflow/routes';
import { filesRouter } from './core/files/routes';
import { notificationsRouter } from './core/notifications/routes';
import { tasksRouter } from './core/tasks/routes';
import { calendarRouter } from './core/calendar/routes';
import { documentsRouter } from './core/documents/routes';
import { draftsRouter } from './core/drafts/routes';
import { commentsRouter } from './core/comments/routes';
import { discussionsRouter } from './core/discussions/routes';
import { exportRouter } from './core/export/routes';
import { registerModules } from './bootstrap';
import { tagsRouter } from './core/tags/routes';
import { partiesRouter } from './core/parties/routes';
import { crmRouter } from './modules/crm/routes';
import { salesRouter } from './modules/sales/routes';
import { salesRequestsRouter } from './modules/sales/requests.routes';
import { pricingRouter } from './modules/sales/pricing.routes';
import { quotesRouter } from './modules/sales/quotes.routes';
import { contractsRouter } from './modules/sales/contracts.routes';
import { salesManagementRouter } from './modules/sales/management.routes';
import { invoicesRouter } from './modules/finance/invoices.routes';
import { hrRouter } from './modules/hr/routes';
import { portalRouter, profileChangesRouter } from './modules/hr/portalRoutes';
import { requestsRouter } from './modules/hr/requests.routes';
import { ticketsRouter } from './modules/tickets/routes';
import { newsRouter } from './modules/news/routes';
import { employeeReportsRouter } from './modules/hr/reports.routes';
import { dashboardRouter } from './modules/hr/dashboard.routes';

/**
 * Express app. Staff realm under /api/v1; the external realm (/api/portal) is added with the
 * customer app / company portal (CLAUDE.md "Two user realms").
 */
export function createApp(): Express {
  const app = express();
  app.set('trust proxy', env().TRUST_PROXY_HOPS);
  app.disable('x-powered-by');
  app.use(requireCloudFrontOrigin); // go-live follow-up 2: CloudFront-only in deployed stages
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cors({ origin: env().APP_URL, credentials: true }));
  app.use(cookieParser());
  // Local file PUT streams raw bodies; everything else is JSON.
  app.use((req, res, next) =>
    req.path.startsWith('/api/v1/files/local/') ? next() : express.json({ limit: '2mb' })(req, res, next),
  );
  if (env().NODE_ENV !== 'test')
    app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url === '/api/health' } }));

  app.get('/api/health', (_req, res) =>
    res.json({ ok: true, service: 'eayni-erp-api', time: new Date().toISOString() }),
  );

  const v1 = express.Router();
  v1.use('/auth', authRouter);
  v1.use('/users', usersRouter);
  v1.use('/roles', rolesRouter);
  v1.use('/settings', settingsRouter);
  v1.use('/audit', auditRouter);
  v1.use('/outbox', outboxRouter);
  v1.use('/org', orgRouter);
  v1.use('/holidays', holidaysRouter);
  v1.use('/workflows', workflowsRouter);
  v1.use('/files', filesRouter);
  v1.use('/notifications', notificationsRouter);
  v1.use('/tasks', tasksRouter);
  v1.use('/calendar', calendarRouter);
  v1.use('/documents', documentsRouter);
  v1.use('/drafts', draftsRouter);
  v1.use('/comments', commentsRouter);
  v1.use('/discussions', discussionsRouter);
  v1.use('/export', exportRouter);
  v1.use('/hr', portalRouter);
  v1.use('/hr/profile-changes', profileChangesRouter);
  v1.use('/hr/requests', requestsRouter);
  v1.use('/hr/employee-reports', employeeReportsRouter);
  v1.use('/hr/dashboard', dashboardRouter);
  v1.use('/tickets', ticketsRouter);
  v1.use('/news', newsRouter);
  v1.use('/hr', hrRouter);
  v1.use('/tags', tagsRouter);
  v1.use('/parties', partiesRouter);
  v1.use('/crm', crmRouter);
  v1.use('/sales/requests', salesRequestsRouter);
  v1.use('/sales/pricelist', pricingRouter);
  v1.use('/sales/quotes', quotesRouter);
  v1.use('/sales/contracts', contractsRouter);
  v1.use('/sales/management', salesManagementRouter);
  v1.use('/finance/invoices', invoicesRouter);
  v1.use('/sales', salesRouter);
  app.use('/api/v1', v1);

  app.use(notFoundHandler);
  app.use(errorHandler);
  registerModules();
  return app;
}
