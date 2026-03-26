// Cross-cutting middleware
export { AppError, errorHandler, successEnvelope, ERROR_CODES, type ErrorCode, type ApiEnvelope } from './errors.js';
export { apiRateLimit, agentRateLimit } from './rate-limit.js';
export { corsMiddleware } from './cors.js';
export { requestIdMiddleware } from './request-id.js';
export { validate } from './validate.js';
export { requestLoggerMiddleware } from './request-logger.js';
export { requireAuth, requireScope, type AuthContext } from './auth.js';
export { requireRole, requirePermission, PERMISSIONS } from './rbac.js';
