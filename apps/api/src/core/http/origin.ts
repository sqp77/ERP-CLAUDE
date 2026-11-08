import { timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { env } from '../../config';

export const ORIGIN_HEADER = 'x-origin-secret';
export const VIEWER_ADDRESS_HEADER = 'cloudfront-viewer-address';

/** `1.2.3.4:5678` or `2001:db8::1:5678` → the address without the port. */
export function parseViewerAddress(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const i = value.lastIndexOf(':');
  const ip = i > 0 ? value.slice(0, i) : value;
  return ip.replace(/^\[|\]$/g, '') || undefined;
}

function sameSecret(given: string | undefined, expected: string): boolean {
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Only CloudFront may talk to the API (go-live follow-up 2): the distribution adds a secret origin header; a request
 * without it (the API Gateway URL called directly) is refused. Because the request is then known to come from
 * CloudFront, the client address is taken from `CloudFront-Viewer-Address` instead of counting X-Forwarded-For hops,
 * which the caller controls when the gateway is reached directly. The health check stays open for monitors.
 */
export function requireCloudFrontOrigin(req: Request, res: Response, next: NextFunction): void {
  const secret = env().ORIGIN_SECRET;
  if (!secret || req.path === '/api/health') return next();
  const given = req.headers[ORIGIN_HEADER];
  if (!sameSecret(typeof given === 'string' ? given : undefined, secret)) {
    res
      .status(403)
      .json({ error: { code: 'forbidden_origin', message: 'الطلب يجب أن يمر عبر الواجهة الرسمية' } });
    return;
  }
  const viewer = parseViewerAddress(
    typeof req.headers[VIEWER_ADDRESS_HEADER] === 'string'
      ? (req.headers[VIEWER_ADDRESS_HEADER] as string)
      : undefined,
  );
  if (viewer) Object.defineProperty(req, 'ip', { value: viewer, configurable: true, enumerable: true });
  next();
}
