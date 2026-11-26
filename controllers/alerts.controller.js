const { AppError } = require('../middleware/error-handler');

function parsePage(req, partitionAttribute, partitionValue) {
  const limit = req.query.limit === undefined ? 100 : Number(req.query.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new AppError(400, 'INVALID_LIMIT', 'limit must be an integer from 1 to 100');
  if (!req.query.cursor) return { limit };
  try {
    const cursor = JSON.parse(Buffer.from(req.query.cursor, 'base64url').toString('utf8'));
    const keys = cursor && typeof cursor === 'object' && !Array.isArray(cursor) ? Object.keys(cursor).sort() : [];
    if (keys.length !== 2 || keys[0] !== 'id' || keys[1] !== partitionAttribute || typeof cursor.id !== 'string' || cursor[partitionAttribute] !== partitionValue) {
      throw new Error('cursor key mismatch');
    }
    return { limit, exclusiveStartKey: cursor };
  }
  catch { throw new AppError(400, 'INVALID_CURSOR', 'cursor is invalid'); }
}

function createAlertsController({ models }) {
  return {
    async list(req, res, next) { try {
      const page = await models.alerts.queryPage('user_id', req.user.id, parsePage(req, 'user_id', req.user.id));
      if (page.lastEvaluatedKey) res.set('X-Next-Cursor', Buffer.from(JSON.stringify(page.lastEvaluatedKey)).toString('base64url'));
      res.json(page.items);
    } catch (error) { next(error); } },
    async markRead(req, res, next) { try {
      const alert = await models.alerts.get({ id: req.params.id });
      if (!alert || alert.user_id !== req.user.id) throw new AppError(404, 'ALERT_NOT_FOUND', 'Alert was not found');
      res.json(await models.alerts.update({ id: alert.id }, { is_read: true }));
    } catch (error) { next(error); } },
  };
}
module.exports = { createAlertsController, parsePage };
