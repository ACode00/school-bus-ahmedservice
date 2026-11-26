const crypto = require('node:crypto');
const request = require('supertest');
const { createApp } = require('../../app');
const { loadConfig } = require('../../config/env');
const { createAwsClients } = require('../../config/aws-clients');
const { createModels } = require('../../models');
const { AuditService } = require('../../services/audit.service');

const enabled = process.env.RUN_FLOCI_INTEGRATION === '1';
const suite = enabled ? describe : describe.skip;
const roleSet = { admin: 'Admins', supervisor: 'Coordinators', parent: 'Parents' };

suite('gateway role profiles and ownership against Floci', () => {
  test('each role gets its allowed methods, role denials hold, and child/bus ownership is enforced', async () => {
    const config = loadConfig(process.env); const clients = createAwsClients(config); const models = createModels({ client: clients.dynamo });
    const suffix = crypto.randomUUID(); const id = (prefix) => `${prefix}-${suffix}`;
    const users = { admin: id('admin'), supervisor: id('supervisor'), parent: id('parent'), otherParent: id('other-parent') };
    const identities = Object.fromEntries(Object.keys(users).map((role) => [role, id(`ic-${role}`)]));
    const data = { route: id('route'), bus: id('bus'), otherBus: id('other-bus'), trip: id('trip'), otherTrip: id('other-trip'), student: id('student'), otherStudent: id('other-student'), routeMutation: id('route-created') };
    const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    const cacheEntries = new Map();
    const cache = {
      async getOrLoad(key, loader) { if (cacheEntries.has(key)) return { value: cacheEntries.get(key), cacheStatus: 'HIT' }; const value = await loader(); cacheEntries.set(key, value); return { value, cacheStatus: 'MISS' }; },
      async invalidatePrefix(prefix) { for (const key of cacheEntries.keys()) if (key.startsWith(prefix)) cacheEntries.delete(key); },
      async invalidate(key) { cacheEntries.delete(key); },
    };
    const app = createApp({ config, services: { ...clients, db: clients.dynamo, models, logger, cache, auditService: new AuditService({ model: models.auditLogs, logger }) } });
    const auth = (role) => ({ 'X-IAM-User-Arn': `arn:aws:sts::000000000000:assumed-role/AWSReservedSSO_BusTracker${roleSet[role]}_abc/${identities[role]}` });
    let createdRouteId;
    try {
      for (const [role, userId] of Object.entries(users)) {
        await models.users.create({ id: userId, identity_store_user_id: identities[role], name: role, email: `${id(role)}@example.test`, role: role === 'otherParent' ? 'parent' : role });
        await models.identityClaims.create({ identity_store_user_id: identities[role], user_id: userId });
      }
      await models.routes.create({ id: data.route, code: suffix, name: 'IAM Test Route', area: 'Integration' });
      await models.buses.create({ id: data.bus, plate_number: id('plate'), route_id: data.route, supervisor_id: users.supervisor });
      await models.buses.create({ id: data.otherBus, plate_number: id('other-plate'), route_id: data.route, supervisor_id: id('unrelated-supervisor') });
      await models.trips.create({ id: data.trip, route_id: data.route, bus_id: data.bus, run_type: 'morning', status: 'scheduled' });
      await models.trips.create({ id: data.otherTrip, route_id: data.route, bus_id: data.otherBus, run_type: 'afternoon', status: 'scheduled' });
      await models.students.create({ id: data.student, name: 'Owned Child', parent_id: users.parent, stop_id: id('stop'), bus_id: data.bus });
      await models.students.create({ id: data.otherStudent, name: 'Other Child', parent_id: users.otherParent, stop_id: id('other-stop'), bus_id: data.otherBus });
      await models.attendance.create({ id: id('other-attendance'), student_id: data.otherStudent, trip_id: data.otherTrip, date: '2026-11-26', status: 'boarded', marked_by: users.supervisor });

      expect((await request(app).get('/api/routes').set(auth('parent'))).status).toBe(200);
      expect((await request(app).post('/api/routes').set(auth('parent')).send({ code: 'P', name: 'Denied', area: 'Test' })).status).toBe(403);
      expect((await request(app).get('/api/routes').set(auth('supervisor'))).status).toBe(200);
      expect((await request(app).post('/api/routes').set(auth('supervisor')).send({ code: 'S', name: 'Denied', area: 'Test' })).status).toBe(403);
      expect((await request(app).get('/api/routes').set(auth('admin'))).status).toBe(200);
      const createRoute = await request(app).post('/api/routes').set(auth('admin')).send({ code: 'A', name: 'Allowed', area: 'Test' });
      expect(createRoute.status).toBe(201);
      createdRouteId = createRoute.body.id;
      expect((await request(app).get('/api/alerts').set(auth('admin'))).status).toBe(403);

      const markOwnBus = await request(app).post(`/api/trips/${data.trip}/attendance`).set(auth('supervisor')).send({ student_id: data.student, date: '2026-11-26', status: 'boarded' });
      expect(markOwnBus.status).toBe(201);
      const wrongBus = await request(app).post(`/api/trips/${data.otherTrip}/attendance`).set(auth('supervisor')).send({ student_id: data.otherStudent, date: '2026-11-26', status: 'boarded' });
      expect(wrongBus.status).toBe(403);
      const parentOwnChild = await request(app).get(`/api/trips/${data.trip}/attendance`).set(auth('parent'));
      expect(parentOwnChild.status).toBe(200);
      expect(parentOwnChild.body.every((row) => row.student_id === data.student)).toBe(true);
      expect((await request(app).get(`/api/trips/${data.otherTrip}/attendance`).set(auth('parent'))).status).toBe(404);
      expect((await request(app).post(`/api/trips/${data.trip}/attendance`).set(auth('parent')).send({ student_id: data.student, date: '2026-11-26', status: 'boarded' })).status).toBe(403);
    } finally {
      for (const identity_store_user_id of Object.values(identities)) {
        await models.identityClaims.delete({ identity_store_user_id }).catch(() => {});
      }
      for (const tripId of [data.trip, data.otherTrip]) for (const row of await models.attendance.findByTripId(tripId).catch(() => [])) await models.attendance.delete({ id: row.id }).catch(() => {});
      for (const modelId of [data.student, data.otherStudent]) await models.students.delete({ id: modelId }).catch(() => {});
      for (const modelId of [data.trip, data.otherTrip]) await models.trips.delete({ id: modelId }).catch(() => {});
      for (const modelId of [data.bus, data.otherBus]) await models.buses.delete({ id: modelId }).catch(() => {});
      await models.routes.delete({ id: data.route }).catch(() => {});
      if (createdRouteId) await models.routes.delete({ id: createdRouteId }).catch(() => {});
      for (const event of await models.notificationOutbox.list({ limit: 100 }).catch(() => [])) if ([data.trip, data.otherTrip].includes(event.trip_id)) await models.notificationOutbox.delete({ id: event.id }).catch(() => {});
      for (const userId of Object.values(users)) await models.users.delete({ id: userId }).catch(() => {});
      for (const audit of await models.auditLogs.list({ limit: 100 }).catch(() => [])) if (Object.values(users).includes(audit.user_id)) await models.auditLogs.delete({ id: audit.id }).catch(() => {});
      await clients.dynamoClient.destroy();
    }
  });
});
