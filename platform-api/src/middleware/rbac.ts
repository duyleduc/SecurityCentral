import type { Request, Response, NextFunction } from 'express';

import { AppError } from './errors.js';

const ROLE_HIERARCHY: Record<string, number> = {
  viewer: 0,
  member: 1,
  admin: 2,
  owner: 3,
};

export const PERMISSIONS = {
  'manage_org': ['owner', 'admin'],
  'manage_users': ['owner', 'admin'],
  'create_api_keys': ['owner', 'admin', 'member'],
  'view_findings': ['owner', 'admin', 'member', 'viewer'],
  'update_findings': ['owner', 'admin', 'member'],
  'trigger_scans': ['owner', 'admin', 'member'],
  'view_dashboard': ['owner', 'admin', 'member', 'viewer'],
  'manage_projects': ['owner', 'admin', 'member'],
  'manage_endpoints': ['owner', 'admin', 'member'],
} as const;

export type Permission = keyof typeof PERMISSIONS;

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

export function requirePermission(permission: Permission) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.auth) {
      return next(new AppError('AUTH_INVALID_CREDENTIALS', 'Authentication required'));
    }

    const allowedRoles: readonly string[] = PERMISSIONS[permission];
    if (!allowedRoles.includes(req.auth.role)) {
      return next(new AppError('AUTH_FORBIDDEN', `Permission '${permission}' denied for role '${req.auth.role}'`));
    }

    next();
  };
}
