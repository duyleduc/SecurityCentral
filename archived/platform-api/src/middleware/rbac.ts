import type { Request, Response, NextFunction } from 'express';

import { AppError } from './errors.js';

// ---------------------------------------------------------------------------
// Role hierarchy (higher index = more permissions)
// ---------------------------------------------------------------------------

const ROLE_HIERARCHY: Record<string, number> = {
  viewer: 0,
  member: 1,
  admin: 2,
  owner: 3,
};

// ---------------------------------------------------------------------------
// Permission matrix (Spec §11.2)
// ---------------------------------------------------------------------------

export const PERMISSIONS = {
  'manage_org': ['owner', 'admin'],
  'manage_integrations': ['owner', 'admin'],
  'manage_users': ['owner', 'admin'],
  'create_api_keys': ['owner', 'admin', 'member'],
  'view_findings': ['owner', 'admin', 'member', 'viewer'],
  'update_findings': ['owner', 'admin', 'member'],
  'trigger_scans': ['owner', 'admin', 'member'],
  'view_dashboard': ['owner', 'admin', 'member', 'viewer'],
} as const;

export type Permission = keyof typeof PERMISSIONS;

/**
 * RBAC middleware — checks if the user's role meets the minimum required role.
 * Uses a hierarchy: viewer < member < admin < owner.
 *
 * Usage:
 * ```ts
 * router.get('/admin-only', requireAuth, requireRole('admin'), handler);
 * ```
 */
export function requireRole(minimumRole: string) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.auth) {
      return next(new AppError('AUTH_INVALID_CREDENTIALS', 'Authentication required'));
    }

    const userLevel = ROLE_HIERARCHY[req.auth.role] ?? -1;
    const requiredLevel = ROLE_HIERARCHY[minimumRole] ?? 0;

    if (userLevel < requiredLevel) {
      return next(new AppError('AUTH_FORBIDDEN', 'Insufficient permissions'));
    }

    next();
  };
}

/**
 * Permission-based RBAC middleware — checks against the spec permission matrix.
 *
 * Usage:
 * ```ts
 * router.patch('/findings/:id', requireAuth, requirePermission('update_findings'), handler);
 * ```
 */
export function requirePermission(permission: Permission) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.auth) {
      return next(new AppError('AUTH_INVALID_CREDENTIALS', 'Authentication required'));
    }

    const allowedRoles = PERMISSIONS[permission];
    if (!allowedRoles.includes(req.auth.role as (typeof allowedRoles)[number])) {
      return next(new AppError('AUTH_FORBIDDEN', `Permission '${permission}' denied for role '${req.auth.role}'`));
    }

    next();
  };
}
