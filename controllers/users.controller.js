const crypto = require('node:crypto');
const { TransactWriteCommand } = require('@aws-sdk/lib-dynamodb');
const { DescribeUserCommand } = require('@aws-sdk/client-identitystore');
const { z } = require('zod');
const { AppError } = require('../middleware/error-handler');
const { recordSafely } = require('../services/audit.service');

const enrollmentSchema = z.object({
  identity_store_user_id: z.string().trim().min(1).max(128),
  role: z.enum(['admin', 'supervisor', 'parent']),
});
const isConflict = (error) => ['TransactionCanceledException', 'ConditionalCheckFailedException'].includes(error?.name);

function createUsersController({ db, models, identityStore, config = {}, auditService, logger }) {
  return {
    async register(req, res, next) {
      const parsed = enrollmentSchema.safeParse(req.body);
      if (!parsed.success) return next(new AppError(400, 'INVALID_INPUT', 'Identity Store user ID and valid app role are required'));
      try {
        const { identity_store_user_id, role } = parsed.data;
        const result = await identityStore.send(new DescribeUserCommand({
          IdentityStoreId: config.ssoIdentityStoreId,
          UserId: identity_store_user_id,
        }));
        const email = result.Emails?.find((entry) => entry.Primary)?.Value || result.Emails?.[0]?.Value;
        if (!result.UserId || !email) return next(new AppError(400, 'INVALID_IDENTITY', 'Identity Store user must have a verified user ID and email'));
        const user = {
          id: crypto.randomUUID(), identity_store_user_id, name: result.DisplayName || result.UserName,
          email: email.toLowerCase(), role, created_at: new Date().toISOString(),
        };
        await db.send(new TransactWriteCommand({ TransactItems: [
          { Put: { TableName: models.users.tableName, Item: user, ConditionExpression: 'attribute_not_exists(#id)', ExpressionAttributeNames: { '#id': 'id' } } },
          { Put: { TableName: models.identityClaims.tableName, Item: { identity_store_user_id, user_id: user.id, created_at: user.created_at }, ConditionExpression: 'attribute_not_exists(#identity)', ExpressionAttributeNames: { '#identity': 'identity_store_user_id' } } },
        ] }));
        await recordSafely(auditService, { userId: req.user.id, event: 'identity_profile_linked', status: 'success', metadata: { target_user_id: user.id, role } }, logger);
        return res.status(201).json({ user });
      } catch (error) {
        if (isConflict(error)) return next(new AppError(409, 'IDENTITY_ALREADY_LINKED', 'Identity Store user is already linked'));
        return next(error);
      }
    },
  };
}

module.exports = { createUsersController, enrollmentSchema, isConflict };
