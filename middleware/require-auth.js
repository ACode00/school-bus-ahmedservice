const crypto = require('node:crypto');
const { AppError } = require('./error-handler');
const { recordSafely } = require('../services/audit.service');

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function requireAuth({ models, auditService, logger }) {
  return async (req, res, next) => {
    try {
      const authorization = req.get('authorization') || '';
      const match = /^Bearer\s+([A-Za-z0-9_-]{40,})$/i.exec(authorization);
      const tokenHash = match ? hashToken(match[1]) : null;
      const session = tokenHash && await models.sessions.get({ id: tokenHash });
      const now = Math.floor(Date.now() / 1000);
      if (!session || Number(session.expires_at) <= now) {
        if (session) await models.sessions.delete({ id: session.id });
        logger?.warn({ event: 'auth_failure', request_id: req.id, status: 401 });
        await recordSafely(auditService, { userId: 'anonymous', event: 'authentication_failed', status: 'failure', metadata: { method: req.method, path: req.path } }, logger);
        return next(new AppError(401, 'UNAUTHENTICATED', 'A valid login session is required'));
      }
      const user = await models.users.get({ id: session.user_id });
      if (!user) return next(new AppError(401, 'UNAUTHENTICATED', 'A valid login session is required'));
      req.user = user;
      req.authSession = session;
      return next();
    } catch (error) { return next(error); }
  };
}

module.exports = { requireAuth, hashToken };
