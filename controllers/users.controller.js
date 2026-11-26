const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const { TransactWriteCommand } = require('@aws-sdk/lib-dynamodb');
const { z } = require('zod');
const { AppError } = require('../middleware/error-handler');
const { recordSafely } = require('../services/audit.service');
const { hashToken } = require('../middleware/require-auth');

const registrationSchema = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.string().trim().email().max(254).transform((email) => email.toLowerCase()),
  password: z.string().min(8).max(72).refine((value) => Buffer.byteLength(value, 'utf8') <= 72),
}).strict();
const SESSION_SECONDS = 8 * 60 * 60;
const isConflict = (error) => ['TransactionCanceledException', 'ConditionalCheckFailedException'].includes(error?.name);

async function issueSession({ models, user }) {
  const token = crypto.randomBytes(32).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const tokenHash = hashToken(token);
  const session = { id: tokenHash, user_id: user.id, token_hash: tokenHash, expires_at: now + SESSION_SECONDS, created_at: new Date(now * 1000).toISOString() };
  await models.sessions.create(session);
  const { password_hash, ...publicUser } = user;
  return { token, expires_at: session.expires_at, user: publicUser };
}

function createUsersController({ db, models, auditService, logger }) {
  return {
    async register(req, res, next) {
      const parsed = registrationSchema.safeParse(req.body);
      if (!parsed.success) return next(new AppError(400, 'INVALID_INPUT', 'Enter your name, a valid email, and a password of at least 8 characters'));
      try {
        const { name, email, password } = parsed.data;
        const user = { id: crypto.randomUUID(), name, email, password_hash: await bcrypt.hash(password, 12), role: 'parent', created_at: new Date().toISOString() };
        await db.send(new TransactWriteCommand({ TransactItems: [
          { Put: { TableName: models.userEmails.tableName, Item: { email, user_id: user.id, created_at: user.created_at }, ConditionExpression: 'attribute_not_exists(#email)', ExpressionAttributeNames: { '#email': 'email' } } },
          { Put: { TableName: models.users.tableName, Item: user, ConditionExpression: 'attribute_not_exists(#id)', ExpressionAttributeNames: { '#id': 'id' } } },
        ] }));
        const session = await issueSession({ models, user });
        await recordSafely(auditService, { userId: user.id, event: 'account_registered', status: 'success' }, logger);
        logger?.info({ event: 'account_registered', user_id: user.id, role: 'parent' });
        return res.status(201).json(session);
      } catch (error) {
        if (isConflict(error)) return next(new AppError(409, 'EMAIL_ALREADY_REGISTERED', 'An account with this email already exists'));
        return next(error);
      }
    },
  };
}

module.exports = { createUsersController, registrationSchema, issueSession, SESSION_SECONDS, isConflict };
