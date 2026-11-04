import type { NextFunction, Request, RequestHandler, Response } from 'express';

/** Wrap an async route so rejections reach the error handler (Express 4). */
export function asyncHandler<Req extends Request = Request>(
  fn: (req: Req, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    fn(req as Req, res, next).catch(next);
  };
}
