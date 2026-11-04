import type { Request } from 'express';
import type { Scope } from '@eayni/shared';
import type { SessionDoc } from '../auth/model';
import type { UserDoc } from '../auth/model';

/** Per-request context attached by `requireAuth` and `authorize`. */
export interface AuthContext {
  user: UserDoc;
  session: SessionDoc;
  /** Role codes the user holds (department-scoped ones included). */
  roleCodes: string[];
  ip: string;
  userAgent: string;
  requestId: string;
}

export interface Authz {
  resource: string;
  action: string;
  /** Widest scope granted across the user's roles for this resource/action. */
  scope: Scope;
  /** Departments the user may reach when scope is 'department' (own dept + dept-scoped roles). */
  departmentIds: string[];
}

export interface AuthedRequest extends Request {
  auth: AuthContext;
  authz?: Authz;
}

/** Actor info for audit and services. Works for unauthenticated contexts too (jobs, system). */
export interface Actor {
  userId?: string;
  email?: string;
  roleCodes: string[];
  ip?: string;
  requestId?: string;
  system?: boolean;
}

export const SYSTEM_ACTOR: Actor = { roleCodes: ['system'], system: true, email: 'system' };

export function actorFrom(req: AuthedRequest): Actor {
  return {
    userId: String(req.auth.user._id),
    email: req.auth.user.email,
    roleCodes: req.auth.roleCodes,
    ip: req.auth.ip,
    requestId: req.auth.requestId,
  };
}
