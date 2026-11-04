import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { logger } from '../../logger';

export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new AppError(400, 'bad_request', message, details);
export const unauthorized = (message = 'غير مصرّح', code = 'unauthorized') =>
  new AppError(401, code, message);
export const forbidden = (message = 'ليست لديك صلاحية لهذا الإجراء', code = 'forbidden') =>
  new AppError(403, code, message);
export const notFound = (message = 'السجل غير موجود') => new AppError(404, 'not_found', message);
export const conflict = (message: string, details?: unknown) =>
  new AppError(409, 'conflict', message, details);

export const notFoundHandler: RequestHandler = (_req, _res, next) => next(notFound('المسار غير موجود'));

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof AppError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
    return;
  }
  if (err instanceof ZodError) {
    res.status(400).json({
      error: {
        code: 'validation_error',
        message: 'بيانات غير صالحة',
        details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      },
    });
    return;
  }
  const e = err as { name?: string; code?: number; keyValue?: unknown; message?: string };
  if (e?.name === 'MongoServerError' && e.code === 11000) {
    res
      .status(409)
      .json({ error: { code: 'duplicate', message: 'القيمة مستخدمة مسبقًا', details: e.keyValue } });
    return;
  }
  if (e?.name === 'CastError') {
    res.status(400).json({ error: { code: 'bad_request', message: 'معرّف غير صالح' } });
    return;
  }
  logger.error({ err, url: req.originalUrl }, 'unhandled error');
  res.status(500).json({ error: { code: 'internal', message: 'حدث خطأ غير متوقع' } });
};
