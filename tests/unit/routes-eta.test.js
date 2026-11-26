const request = require('supertest');
const { TransactWriteCommand } = require('@aws-sdk/lib-dynamodb');
const { createApp } = require('../../app');
const { CacheService } = require('../../services/cache.service');
const { createRedisTestClient } = require('../helpers/redis-client');
const { authHeader, sessionLookup } = require('../helpers/auth');

function setup(role = 'admin') {
  const trip = { id: 'trip-1', route_id: 'route-1', bus_id: 'bus-1', status: 'scheduled' };
  const models = {
    users: { tableName: 'Users', get: jest.fn().mockImplementation(async ({ id }) => id === 'parent-1' ? { id, role: 'parent' } : { id: 'user-1', role }) }, sessions: sessionLookup('user-1'), auditLogs: { tableName: 'AuditLogs' },
    trips: { tableName: 'Trips', get: jest.fn().mockResolvedValue(trip) },
    routes: { get: jest.fn().mockResolvedValue({ id: 'route-1', name: 'North' }), list: jest.fn().mockResolvedValue([]), create: jest.fn().mockImplementation(async (item) => item), update: jest.fn(), delete: jest.fn(), findByName: jest.fn().mockResolvedValue([]), findByArea: jest.fn().mockResolvedValue([]) },
    stops: { get: jest.fn().mockResolvedValue({ id: 'stop-1', route_id: 'route-1', name: 'Gate', stop_order: 1 }), findByRouteId: jest.fn().mockResolvedValue([{ id: 'stop-1', route_id: 'route-1', name: 'Gate', stop_order: 1 }]), create: jest.fn(), update: jest.fn().mockResolvedValue({ id: 'stop-1', route_id: 'route-1', name: 'Main Gate', stop_order: 2 }), delete: jest.fn() },
    buses: { get: jest.fn().mockResolvedValue({ id: 'bus-1', route_id: 'route-1' }), findByRouteId: jest.fn().mockResolvedValue([]) },
    students: { create: jest.fn(), findByBusId: jest.fn().mockResolvedValue([]) },
    tripStops: { queryPartition: jest.fn().mockResolvedValue([{ trip_id: 'trip-1', stop_id: 'stop-1', arrive_from: '07:00', arrive_to: '07:10' }]) },
    notificationOutbox: { tableName: 'NotificationOutbox' },
  };
  const services = {
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() }, models,
    db: { send: jest.fn().mockResolvedValue({}) }, cache: new CacheService({ client: createRedisTestClient() }),
    auditService: { record: jest.fn().mockResolvedValue({}) },
    idFactory: (() => { let id = 0; return () => `id-${++id}`; })(),
  };
  return { app: createApp({ services, config: { corsOrigins: [], sessionTtlSeconds: 28_800 } }), services };
}

const authFor = () => authHeader();
const auth = authFor();

test('ETA returns ordered arrival windows and serves cache HIT until times are replaced', async () => {
  const { app, services } = setup();
  const first = await request(app).get('/api/trips/trip-1/eta').set(auth);
  const second = await request(app).get('/api/trips/trip-1/eta').set(auth);
  expect(first.status).toBe(200);
  expect(first.headers['x-cache']).toBe('MISS');
  expect(second.headers['x-cache']).toBe('HIT');
  expect(first.body.stops[0]).toMatchObject({ stop_id: 'stop-1', arrive_from: '07:00', name: 'Gate', stop_order: 1 });

  const updated = await request(app).put('/api/trips/trip-1/times').set(auth).send({
    stops: [{ stop_id: 'stop-1', arrive_from: '07:20', arrive_to: '07:30' }],
  });
  expect(updated.status).toBe(200);
  expect(services.db.send.mock.calls[0][0]).toBeInstanceOf(TransactWriteCommand);
  const after = await request(app).get('/api/trips/trip-1/eta').set(auth);
  expect(after.headers['x-cache']).toBe('MISS');
});

test('only admins can replace trip times and windows are validated', async () => {
  const parent = setup('parent');
  expect((await request(parent.app).put('/api/trips/trip-1/times').set(authFor('parent')).send({ stops: [] })).status).toBe(403);
  expect(parent.services.auditService.record).toHaveBeenCalledWith(expect.objectContaining({ event: 'authorization_failed', status: 'failure' }));
  const admin = setup();
  expect((await request(admin.app).put('/api/trips/trip-1/times').set(auth).send({
    stops: [{ stop_id: 'stop-1', arrive_from: '08:00', arrive_to: '07:00' }],
  })).status).toBe(400);
  expect(admin.services.db.send).not.toHaveBeenCalled();
});

test('route readers are authenticated and student creation is admin-only', async () => {
  const parent = setup('parent');
  expect((await request(parent.app).get('/api/trips/trip-1/eta')).status).toBe(401);
  expect((await request(parent.app).post('/api/students').set(authFor('parent')).send({})).status).toBe(403);
  const admin = setup();
  admin.services.models.users.get.mockImplementation(async ({ id }) => id === 'parent-1' ? { id, role: 'parent' } : { id: 'user-1', role: 'admin' });
  admin.services.models.stops.get = jest.fn().mockResolvedValue({ id: 'stop-1', route_id: 'route-1' });
  const response = await request(admin.app).post('/api/students').set(auth).send({ name: 'A Student', parent_id: 'parent-1', stop_id: 'stop-1', bus_id: 'bus-1' });
  expect(response.status).toBe(201);
});

test('route list reads cache and route writes invalidate shared lookup entries', async () => {
  const { app, services } = setup();
  const first = await request(app).get('/api/routes').set(auth);
  const hit = await request(app).get('/api/routes').set(auth);
  expect(first.headers['x-cache']).toBe('MISS'); expect(hit.headers['x-cache']).toBe('HIT');
  const write = await request(app).post('/api/routes').set(auth).send({ code: 'A1', name: 'North', area: 'East' });
  expect(write.status).toBe(201);
  expect((await request(app).get('/api/routes').set(auth)).headers['x-cache']).toBe('MISS');
  expect(services.models.routes.create).toHaveBeenCalled();
});

test('stop lookup is cached and responds at the documented /api/stops path', async () => {
  const { app, services } = setup();
  const first = await request(app).get('/api/stops/stop-1').set(auth);
  const second = await request(app).get('/api/stops/stop-1').set(auth);
  expect(first.status).toBe(200); expect(first.headers['x-cache']).toBe('MISS'); expect(second.headers['x-cache']).toBe('HIT');
  expect(services.models.stops.get).toHaveBeenCalledTimes(1);
});

test('stop mutations invalidate planned ETA caches that depend on stop ordering', async () => {
  const { app } = setup();
  expect((await request(app).get('/api/trips/trip-1/eta').set(auth)).headers['x-cache']).toBe('MISS');
  expect((await request(app).get('/api/trips/trip-1/eta').set(auth)).headers['x-cache']).toBe('HIT');
  expect((await request(app).patch('/api/routes/route-1/stops/stop-1').set(auth).send({ stop_order: 2 })).status).toBe(200);
  expect((await request(app).get('/api/trips/trip-1/eta').set(auth)).headers['x-cache']).toBe('MISS');
});

test('student registration rejects a bus and stop on different routes', async () => {
  const { app, services } = setup();
  services.models.users.get.mockImplementation(async ({ id }) => id === 'parent-1' ? { id, role: 'parent' } : { id: 'user-1', role: 'admin' });
  services.models.stops.get = jest.fn().mockResolvedValue({ id: 'stop-1', route_id: 'different-route' });
  const response = await request(app).post('/api/students').set(auth).send({ name: 'A Student', parent_id: 'parent-1', stop_id: 'stop-1', bus_id: 'bus-1' });
  expect(response.status).toBe(409);
  expect(services.models.students.create).not.toHaveBeenCalled();
});

test('admin status change invalidates ETA and creates a cancellation notification event', async () => {
  const { app, services } = setup();
  const response = await request(app).patch('/api/trips/trip-1/status').set(auth).send({ status: 'cancelled', cancelled_date: '2026-11-26' });
  expect(response.status).toBe(200);
  const transaction = services.db.send.mock.calls[0][0];
  expect(transaction).toBeInstanceOf(TransactWriteCommand);
  expect(transaction.input.TransactItems[1].Put.Item).toMatchObject({ type: 'TRIP_CANCELLED', event_status: 'cancelled' });
  expect((await request(app).get('/api/trips/trip-1/eta').set(auth)).headers['x-cache']).toBe('MISS');
});

test('trip cancellation date must be a real ISO calendar date', async () => {
  const { app, services } = setup();
  const response = await request(app).patch('/api/trips/trip-1/status').set(auth).send({ status: 'cancelled', cancelled_date: '2026-02-30' });
  expect(response.status).toBe(400);
  expect(services.db.send).not.toHaveBeenCalled();
});
