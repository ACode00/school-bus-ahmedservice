const { AppError } = require('./error-handler');
const { recordSafely } = require('../services/audit.service');

function requireRole(...args) {
  const services = args[0] && typeof args[0] === 'object' ? args.shift() : {};
  const roles = args;
  return async (req, res, next) => {
    if (!req.user) {
      await recordSafely(services.auditService, { userId: 'anonymous', event: 'authorization_failed', status: 'failure', metadata: { method: req.method, path: req.path, required_roles: roles } }, services.logger);
      next(new AppError(401, 'UNAUTHENTICATED', 'Authentication is required'));
      return;
    }
    if (!roles.includes(req.user.role)) {
      await recordSafely(services.auditService, { userId: req.user.id, event: 'authorization_failed', status: 'failure', metadata: { method: req.method, path: req.path, role: req.user.role, required_roles: roles } }, services.logger);
      next(new AppError(403, 'FORBIDDEN', 'You do not have permission to perform this action'));
      return;
    }
    next();
  };
}

module.exports = { requireRole };
