import type { RequestHandler } from 'express';
import type { Action, RoleAssignment } from '@eayni/shared';
import { forbidden } from '../http/errors';
import type { AuthedRequest } from '../http/context';
import { effectivePermission } from './service';

/**
 * Enforce resource × action on the server (golden rule 1). Attaches the effective scope to `req.authz`
 * so services can narrow their queries ('own' / 'team' / 'department' / 'all').
 */
export function authorize(resource: string, action: Action): RequestHandler {
  const handler: RequestHandler = (req, _res, next) => {
    const r = req as AuthedRequest;
    if (!r.auth) return next(forbidden('غير مصرّح', 'unauthorized'));
    const user = r.auth.user;
    effectivePermission(
      user.roles as RoleAssignment[],
      user.departmentId ? String(user.departmentId) : undefined,
      resource,
      action,
      String(user._id),
    )
      .then((eff) => {
        if (!eff) return next(forbidden());
        r.authz = { resource, action, scope: eff.scope, departmentIds: eff.departmentIds };
        next();
      })
      .catch(next);
  };
  // Read by the OpenAPI generator (core/openapi): `x-permission` shows the enforced resource × action.
  return Object.assign(handler, { permission: { resource, action } });
}

/** Quick check for use inside services (no middleware). */
export async function can(
  user: AuthedRequest['auth']['user'],
  resource: string,
  action: Action,
): Promise<boolean> {
  const eff = await effectivePermission(
    user.roles as RoleAssignment[],
    user.departmentId ? String(user.departmentId) : undefined,
    resource,
    action,
    String(user._id),
  );
  return !!eff;
}
