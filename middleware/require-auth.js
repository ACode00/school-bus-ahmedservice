const { AppError } = require('./error-handler');
const { recordSafely } = require('../services/audit.service');

function parseIdentityCenterPrincipal(arn) {
  if (typeof arn !== 'string') return null;
  const match = /^arn:[^:]+:sts::\d{12}:assumed-role\/(?:AWSReservedSSO_)?(BusTrackerParents|BusTrackerCoordinators|BusTrackerAdmins)_[^/]+\/([^/]+)$/.exec(arn);
  if (!match) return null;
  const roles = { BusTrackerParents: 'parent', BusTrackerCoordinators: 'supervisor', BusTrackerAdmins: 'admin' };
  return { identityStoreUserId: match[2], role: roles[match[1]] };
}

function requireAuth({ models, auditService, logger }) {
  return async (req, res, next) => {
    try {
      const principal = parseIdentityCenterPrincipal(req.get('x-iam-user-arn'));
      const claim = principal && await models.identityClaims.get({ identity_store_user_id: principal.identityStoreUserId });
      const user = claim && await models.users.get({ id: claim.user_id });
      if (!user) {
        logger?.warn({ event: 'auth_failure', request_id: req.id, status: 401 });
        await recordSafely(auditService, { userId: 'anonymous', event: 'authentication_failed', status: 'failure', metadata: { method: req.method, path: req.path } }, logger);
        next(new AppError(401, 'UNAUTHENTICATED', 'A linked Identity Center identity is required'));
        return;
      }
      if (user.role !== principal.role) {
        await recordSafely(auditService, { userId: user.id, event: 'identity_role_mismatch', status: 'failure' }, logger);
        next(new AppError(403, 'IDENTITY_ROLE_MISMATCH', 'Identity Center role does not match the application profile'));
        return;
      }
      req.user = user;
      next();
    } catch (error) { next(error); }
  };
}

module.exports = { requireAuth, parseIdentityCenterPrincipal };
