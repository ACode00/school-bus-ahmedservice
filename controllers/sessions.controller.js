const bcrypt = require('bcryptjs');
const { z } = require('zod');
const { AppError } = require('../middleware/error-handler');
const { issueSession } = require('./users.controller');
const { recordSafely } = require('../services/audit.service');
const { LoginLimiter } = require('../services/login-limiter.service');

const loginSchema = z.object({ email: z.string().trim().email().max(254).transform((email) => email.toLowerCase()), password: z.string().min(1).max(72) }).strict();

// The socket address is used, never X-Forwarded-For, because a client can fake that header.
function clientIp(req) {
  return req.socket?.remoteAddress || 'unknown';
}

function createSessionsController({ models, auditService, logger, loginLimiter, cache }) {
  const limiter = loginLimiter || new LoginLimiter({ client: cache?.client || null, logger });

  return {
    async create(req, res, next) {
      const parsed = loginSchema.safeParse(req.body);
      if (!parsed.success) return next(new AppError(400, 'INVALID_INPUT', 'A valid email and password are required'));
      const { email, password } = parsed.data;
      const ip = clientIp(req);
      try {
        const limit = await limiter.check(email, ip);
        if (limit.blocked) {
          await recordSafely(auditService, { userId: 'anonymous', event: 'login_blocked', status: 'failure' }, logger);
          res.set('Retry-After', String(limit.retryAfter));
          return next(new AppError(429, 'TOO_MANY_LOGIN_ATTEMPTS', 'Too many failed logins. Try again later.'));
        }
        const claim = await models.userEmails.get({ email });
        const user = claim && await models.users.get({ id: claim.user_id });
        const valid = user?.password_hash && await bcrypt.compare(password, user.password_hash);
        if (!valid) {
          await limiter.recordFailure(email, ip);
          await recordSafely(auditService, { userId: user?.id || 'anonymous', event: 'login_failed', status: 'failure' }, logger);
          // Same answer for a wrong email and a wrong password.
          return next(new AppError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect'));
        }
        await limiter.reset(email);
        const session = await issueSession({ models, user });
        await recordSafely(auditService, { userId: user.id, event: 'login_succeeded', status: 'success' }, logger);
        return res.json(session);
      } catch (error) { return next(error); }
    },
    async remove(req, res, next) {
      try {
        await models.sessions.delete({ id: req.authSession.id });
        await recordSafely(auditService, { userId: req.user.id, event: 'logout', status: 'success' }, logger);
        return res.status(204).end();
      } catch (error) { return next(error); }
    },
  };
}

module.exports = { createSessionsController, loginSchema };
