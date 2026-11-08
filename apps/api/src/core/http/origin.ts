import { timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { env } from '../../config';
import { logger } from '../../logger';

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

const UNKNOWN_IP = Symbol('clientIpUnknown');
let warnedMissingViewerAddress = false;

/**
 * The client address to use for logs, sessions and per-IP limits: `req.ip` when it is trustworthy (local
 * development, or CloudFront's viewer address), `undefined` when the request came through CloudFront but the
 * viewer header did not arrive. Callers must then skip IP-keyed limits rather than share one bucket.
 */
export function clientIp(req: Request): string | undefined {
  return (req as Request & { [UNKNOWN_IP]?: boolean })[UNKNOWN_IP] ? undefined : req.ip;
}

/**
 * Only CloudFront may talk to the API (go-live follow-up 2): the distribution adds a secret origin header; a request
 * without it (the API Gateway URL called directly) is refused. Both the current and the previous secret are accepted
 * so a rotation never 403s while CloudFront propagates. Because the request is then known to come from CloudFront,
 * the client address is taken from `CloudFront-Viewer-Address`; when that header is missing the IP is marked unknown
 * (never a shared fallback value) and a warning is logged once per container. The health check stays open.
 */
export function requireCloudFrontOrigin(req: Request, res: Response, next: NextFunction): void {
  const { ORIGIN_SECRET: secret, ORIGIN_SECRET_PREVIOUS: previous } = env();
  if (!secret || req.path === '/api/health') return next();
  const raw = req.headers[ORIGIN_HEADER];
  const given = typeof raw === 'string' ? raw : undefined;
  if (!sameSecret(given, secret) && !(previous && sameSecret(given, previous))) {
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
  if (viewer) {
    Object.defineProperty(req, 'ip', { value: viewer, configurable: true, enumerable: true });
  } else {
    (req as Request & { [UNKNOWN_IP]?: boolean })[UNKNOWN_IP] = true;
    Object.defineProperty(req, 'ip', { value: undefined, configurable: true, enumerable: true });
    if (!warnedMissingViewerAddress) {
      warnedMissingViewerAddress = true;
      logger.warn(
        { path: req.path },
        'CloudFront-Viewer-Address missing: client IPs are unknown; per-IP limits are skipped (check the origin request policy)',
      );
    }
  }
  next();
}

/** Test hook: forget that the missing-header warning was logged. */
export function resetViewerAddressWarning(): void {
  warnedMissingViewerAddress = false;
}
