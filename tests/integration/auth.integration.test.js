const crypto = require('node:crypto');
const request = require('supertest');
const { createApp } = require('../../app');
const { loadConfig } = require('../../config/env');
const { createAwsClients } = require('../../config/aws-clients');
const { createModels } = require('../../models');
const { AuditService } = require('../../services/audit.service');
const { hashToken } = require('../../middleware/require-auth');

const enabled = process.env.RUN_FLOCI_INTEGRATION === '1';
const suite = enabled ? describe : describe.skip;

suite('email/password authentication against Floci DynamoDB', () => {
  test('signup, login, bearer authorization, and logout use DynamoDB sessions', async () => {
    const config = loadConfig(process.env);
    const clients = createAwsClients(config);
    const models = createModels({ client: clients.dynamo });
    const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    const auditService = new AuditService({ model: models.auditLogs, logger });
    const cache = { getOrLoad: async (_key, loader) => ({ value: await loader(), cacheStatus: 'MISS' }) };
    const app = createApp({ config, services: { ...clients, db: clients.dynamo, models, logger, cache, auditService } });
    const email = `${crypto.randomUUID()}@example.test`;
    let userId; let sessionId; let signupSessionId;

    try {
      const signup = await request(app).post('/api/users').send({ name: 'Integration Parent', email, password: 'integration-password' });
      expect(signup.status).toBe(201);
      userId = signup.body.user.id;
      signupSessionId = (await models.sessions.get({ id: hashToken(signup.body.token) }))?.id;
      expect(signup.body.user.role).toBe('parent');
      expect((await models.users.get({ id: userId })).password_hash).toBeTruthy();
      expect((await models.userEmails.get({ email })).user_id).toBe(userId);
      expect((await request(app).get('/api/routes').set({ Authorization: `Bearer ${signup.body.token}` })).status).toBe(200);
      const login = await request(app).post('/api/sessions').send({ email, password: 'integration-password' });
      expect(login.status).toBe(200);
      const hash = hashToken(login.body.token);
      const session = await models.sessions.get({ id: hash });
      sessionId = session.id;
      expect(session.expires_at - Math.floor(Date.now() / 1000)).toBeGreaterThan(28790);
      expect((await request(app).delete('/api/sessions/current').set({ Authorization: `Bearer ${login.body.token}` })).status).toBe(204);
      expect((await request(app).get('/api/routes').set({ Authorization: `Bearer ${login.body.token}` })).status).toBe(401);
    } finally {
      if (sessionId) await models.sessions.delete({ id: sessionId }).catch(() => {});
      if (signupSessionId) await models.sessions.delete({ id: signupSessionId }).catch(() => {});
      const claim = await models.userEmails.get({ email }).catch(() => null);
      if (claim) await models.userEmails.delete({ email }).catch(() => {});
      if (userId) await models.users.delete({ id: userId }).catch(() => {});
      await clients.dynamoClient.destroy();
    }
  });
});
