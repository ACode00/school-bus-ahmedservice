const bcrypt = require('bcryptjs');
const { z } = require('zod');
const { AppError } = require('../middleware/error-handler');
const { issueSession } = require('./users.controller');
const { recordSafely } = require('../services/audit.service');

const loginSchema = z.object({ email: z.string().trim().email().max(254).transform((email) => email.toLowerCase()), password: z.string().min(1).max(72) }).strict();

function createSessionsController({ models, auditService, logger }) {
  return {
    async create(req, res, next) {
      const parsed = loginSchema.safeParse(req.body);
      if (!parsed.success) return next(new AppError(400, 'INVALID_INPUT', 'A valid email and password are required'));
      try {
        const claim = await models.userEmails.get({ email: parsed.data.email });
        const user = claim && await models.users.get({ id: claim.user_id });
        const valid = user?.password_hash && await bcrypt.compare(parsed.data.password, user.password_hash);
        if (!valid) {
          await recordSafely(auditService, { userId: user?.id || 'anonymous', event: 'login_failed', status: 'failure' }, logger);
          return next(new AppError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect'));
        }
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
