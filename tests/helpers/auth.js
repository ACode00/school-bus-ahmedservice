const UNIT_TOKEN = 'unit-test-session-token-0123456789abcdef0123456789';
const crypto = require('node:crypto');
const { hashToken } = require('../../middleware/require-auth');

function authHeader() {
  return { Authorization: `Bearer ${UNIT_TOKEN}` };
}

function sessionLookup(userId = 'user-1') {
  return {
    get: jest.fn().mockResolvedValue({ id: 'test-session', user_id: userId, expires_at: Math.floor(Date.now() / 1000) + 3600 }),
    delete: jest.fn(),
  };
}

async function createBearerSession(models, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const id = crypto.randomUUID();
  const tokenHash = hashToken(token);
  await models.sessions.create({ id: tokenHash, user_id: userId, token_hash: tokenHash, expires_at: Math.floor(Date.now() / 1000) + 3600, created_at: new Date().toISOString() });
  return { id: tokenHash, headers: { Authorization: `Bearer ${token}` } };
}

module.exports = { UNIT_TOKEN, authHeader, sessionLookup, createBearerSession };
