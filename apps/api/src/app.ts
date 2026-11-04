import express, { type Express } from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { env } from './config';
import { logger } from './logger';
import { errorHandler, notFoundHandler } from './core/http/errors';
import { authRouter } from './core/auth/routes';
import { usersRouter } from './core/auth/usersRoutes';
import { rolesRouter } from './core/rbac/routes';
import { settingsRouter } from './core/settings/routes';
import { auditRouter } from './core/audit/routes';
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
import { exportRouter } from './core/export/routes';
import { registerCoreJobs } from './bootstrap';

/**
 * Express app. Staff realm under /api/v1; the external realm (/api/portal) is added with the
 * customer app / company portal (CLAUDE.md "Two user realms").
 */
export function createApp(): Express {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cors({ origin: env().APP_URL, credentials: true }));
  app.use(cookieParser());
  // Local file PUT streams raw bodies; everything else is JSON.
  app.use((req, res, next) => (req.path.startsWith('/api/v1/files/local/') ? next() : express.json({ limit: '2mb' })(req, res, next)));
  if (env().NODE_ENV !== 'test') app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url === '/api/health' } }));

  app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'eayni-erp-api', time: new Date().toISOString() }));

  const v1 = express.Router();
  v1.use('/auth', authRouter);
  v1.use('/users', usersRouter);
  v1.use('/roles', rolesRouter);
  v1.use('/settings', settingsRouter);
  v1.use('/audit', auditRouter);
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
  v1.use('/export', exportRouter);
  app.use('/api/v1', v1);

  app.use(notFoundHandler);
  app.use(errorHandler);
  registerCoreJobs();
  return app;
}
