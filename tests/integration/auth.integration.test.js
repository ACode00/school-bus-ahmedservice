const crypto = require('node:crypto');
const request = require('supertest');
const { createApp } = require('../../app');
const { loadConfig } = require('../../config/env');
const { createAwsClients } = require('../../config/aws-clients');
const { createModels } = require('../../models');
const { AuditService } = require('../../services/audit.service');

const enabled = process.env.RUN_FLOCI_INTEGRATION === '1';
const suite = enabled ? describe : describe.skip;

suite('Identity Center principal mapping against Floci DynamoDB', () => {
  test('resolves linked role principals, rejects unknown principals and role mismatch', async () => {
    const config = loadConfig(process.env);
    const clients = createAwsClients(config);
    const models = createModels({ client: clients.dynamo });
    const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    const auditService = new AuditService({ model: models.auditLogs, logger });
    const cache = { getOrLoad: async (_key, loader) => ({ value: await loader(), cacheStatus: 'MISS' }) };
    const app = createApp({ config, services: { ...clients, db: clients.dynamo, models, logger, cache, auditService } });
    const identityId = `it-${crypto.randomUUID()}`;
    const userId = crypto.randomUUID();
    await models.users.create({ id: userId, identity_store_user_id: identityId, name: 'Integration Admin', email: `${userId}@example.test`, role: 'admin' });
    await models.identityClaims.create({ identity_store_user_id: identityId, user_id: userId });
    const arn = `arn:aws:sts::000000000000:assumed-role/AWSReservedSSO_BusTrackerAdmins_abc/${identityId}`;

    try {
      const linked = await request(app).get('/api/routes').set('X-IAM-User-Arn', arn);
      expect(linked.status).toBe(200);
      expect((await request(app).get('/api/routes')).status).toBe(401);
      const mismatch = await request(app).get('/api/routes').set('X-IAM-User-Arn', arn.replace('BusTrackerAdmins', 'BusTrackerParents'));
      expect(mismatch.status).toBe(403);
    } finally {
      await models.identityClaims.delete({ identity_store_user_id: identityId });
      await models.users.delete({ id: userId });
      await clients.dynamoClient.destroy();
    }
  });
});
