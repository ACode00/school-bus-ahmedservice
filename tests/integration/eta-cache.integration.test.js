const crypto = require('node:crypto');
const request = require('supertest');
const { createApp } = require('../../app');
const { loadConfig } = require('../../config/env');
const { createAwsClients } = require('../../config/aws-clients');
const { createModels } = require('../../models');
const { AuditService } = require('../../services/audit.service');
const { CacheService } = require('../../services/cache.service');
const { createRedisClient } = require('../../services/redis-client');

const enabled = process.env.RUN_FLOCI_INTEGRATION === '1';
(enabled ? describe : describe.skip)('ETA cache against Floci', () => {
  test('persists schedule windows and invalidates cached ETA after admin update', async () => {
    const config = loadConfig(process.env); const clients = createAwsClients(config); const models = createModels({ client: clients.dynamo });
    const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() }; const suffix = crypto.randomUUID();
    const ids = { user: `u-${suffix}`, route: `r-${suffix}`, stop: `s-${suffix}`, bus: `b-${suffix}`, trip: `t-${suffix}` };
    const identityId = `ic-${suffix}`;
    const redis = createRedisClient(config, logger);
    let cache;
    try {
      await redis.connect();
      await models.users.create({ id: ids.user, identity_store_user_id: identityId, name: 'Integration Admin', email: `${suffix}@example.test`, role: 'admin' });
      await models.identityClaims.create({ identity_store_user_id: identityId, user_id: ids.user });
      await models.routes.create({ id: ids.route, code: suffix, name: 'Floci Route', area: 'Integration' });
      await models.stops.create({ id: ids.stop, route_id: ids.route, name: 'Gate', stop_order: 1 });
      await models.buses.create({ id: ids.bus, plate_number: suffix, route_id: ids.route, supervisor_id: ids.user });
      await models.trips.create({ id: ids.trip, route_id: ids.route, bus_id: ids.bus, run_type: 'morning', status: 'scheduled' });
      cache = new CacheService({ client: redis, defaultTtlMs: config.cacheTtlMs, logger });
      const app = createApp({ config, services: {
        ...clients, db: clients.dynamo, models, logger, cache,
        auditService: new AuditService({ model: models.auditLogs, logger }),
      } });
      const headers = { 'X-IAM-User-Arn': `arn:aws:sts::000000000000:assumed-role/AWSReservedSSO_BusTrackerAdmins_abc/${identityId}` };
      const first = await request(app).get(`/api/trips/${ids.trip}/eta`).set(headers);
      expect(first.status).toBe(200); expect(first.headers['x-cache']).toBe('MISS');
      const update = await request(app).put(`/api/trips/${ids.trip}/times`).set(headers).send({ stops: [{ stop_id: ids.stop, arrive_from: '06:55', arrive_to: '07:05' }] });
      expect(update.status).toBe(200);
      const refreshed = await request(app).get(`/api/trips/${ids.trip}/eta`).set(headers);
      expect(refreshed.headers['x-cache']).toBe('MISS'); expect(refreshed.body.stops[0].arrive_from).toBe('06:55');
      expect((await request(app).get(`/api/trips/${ids.trip}/eta`).set(headers)).headers['x-cache']).toBe('HIT');
    } finally {
      await models.identityClaims.delete({ identity_store_user_id: identityId }).catch(() => {});
      if (redis.isOpen) { if (cache) await cache.invalidate(`trip:eta:${ids.trip}`); await redis.quit(); }
      await models.tripStops.delete({ trip_id: ids.trip, stop_id: ids.stop }).catch(() => {});
      const pending = await models.notificationOutbox.list({ limit: 100 });
      for (const event of pending.filter((item) => item.trip_id === ids.trip)) await models.notificationOutbox.delete({ id: event.id });
      await models.trips.delete({ id: ids.trip }).catch(() => {}); await models.buses.delete({ id: ids.bus }).catch(() => {});
      await models.stops.delete({ id: ids.stop }).catch(() => {}); await models.routes.delete({ id: ids.route }).catch(() => {});
      await models.users.delete({ id: ids.user }).catch(() => {}); await clients.dynamoClient.destroy();
    }
  });
});
