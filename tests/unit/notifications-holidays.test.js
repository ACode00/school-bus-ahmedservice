const request = require('supertest');
const { ReceiveMessageCommand, DeleteMessageCommand, SendMessageCommand } = require('@aws-sdk/client-sqs');
const { createApp } = require('../../app');
const { NotificationService } = require('../../services/notification.service');
const { CacheService } = require('../../services/cache.service');
const { createRedisTestClient } = require('../helpers/redis-client');
const { authHeader, sessionLookup } = require('../helpers/auth');

test('publishes notification outbox event to SQS and marks it published', async () => {
  const sqs = { send: jest.fn().mockResolvedValue({ MessageId: 'message-1' }) };
  const outbox = { update: jest.fn().mockResolvedValue({}) };
  const service = new NotificationService({ sqs, models: { notificationOutbox: outbox }, queueUrl: 'http://localhost/queue', logger: { info: jest.fn() } });
  await service.publish({ id: 'event-1', type: 'ATTENDANCE_UPDATED', parent_id: 'parent-1' });
  expect(sqs.send.mock.calls[0][0]).toBeInstanceOf(SendMessageCommand);
  expect(JSON.parse(sqs.send.mock.calls[0][0].input.MessageBody)).toMatchObject({ id: 'event-1' });
  expect(outbox.update).toHaveBeenCalledWith({ id: 'event-1' }, expect.objectContaining({ status: 'PUBLISHED' }));
});

test('SQS worker writes one alert per parent and deletes only a processed message', async () => {
  const sqs = { send: jest.fn()
    .mockResolvedValueOnce({ Messages: [{ MessageId: 'message-1', ReceiptHandle: 'receipt-1', Body: JSON.stringify({ id: 'event-1', user_ids: ['p1', 'p2'], type: 'ATTENDANCE_UPDATED', message: 'Bus update', trip_id: 't1' }) }] })
    .mockResolvedValueOnce({}) };
  const alerts = { create: jest.fn().mockImplementation(async (item) => item) };
  const service = new NotificationService({ sqs, models: { alerts, notificationOutbox: {} }, queueUrl: 'http://localhost/queue', logger: { info: jest.fn() }, idFactory: (event, user) => `${event}-${user}` });
  await service.pollOnce();
  expect(sqs.send.mock.calls[0][0]).toBeInstanceOf(ReceiveMessageCommand);
  expect(alerts.create).toHaveBeenCalledTimes(2);
  expect(alerts.create.mock.calls[0][0]).toMatchObject({ id: 'event-1-p1', user_id: 'p1', trip_id: 't1', is_read: false });
  expect(sqs.send.mock.calls[1][0]).toBeInstanceOf(DeleteMessageCommand);
});

test('holiday reads cache by year and admin mutations invalidate the cached year', async () => {
  const cache = new CacheService({ client: createRedisTestClient() });
  const models = {
    users: { get: jest.fn().mockResolvedValue({ id: 'a1', role: 'admin' }) }, sessions: sessionLookup('a1'), auditLogs: {},
    holidays: { findByYear: jest.fn().mockResolvedValue([{ id: 'h1', year: '2027', name: 'Holiday', date: '2027-01-01' }]), create: jest.fn().mockImplementation(async (item) => item) },
    alerts: { queryPage: jest.fn().mockResolvedValue({ items: [], lastEvaluatedKey: null }) },
  };
  const services = { db: {}, models, cache, logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } };
  const app = createApp({ services, config: { corsOrigins: [] } }); const auth = authHeader();
  const first = await request(app).get('/api/holidays?year=2027').set(auth);
  expect(first.headers['x-cache']).toBe('MISS');
  expect((await request(app).get('/api/holidays?year=2027').set(auth)).headers['x-cache']).toBe('HIT');
  expect((await request(app).post('/api/holidays').set(auth).send({ name: 'School Holiday', date: '2027-01-02', year: '2027' })).status).toBe(201);
  expect((await request(app).post('/api/holidays').set(auth).send({ name: 'Invalid', date: '2027-02-30', year: '2027' })).status).toBe(400);
  expect((await request(app).get('/api/holidays?year=2027').set(auth)).headers['x-cache']).toBe('MISS');
});

test('parent alert collection uses the documented path and rejects other roles', async () => {
  const services = {
    db: {}, cache: new CacheService({ client: createRedisTestClient() }), models: { users: { get: jest.fn().mockResolvedValue({ id: 'user-1', role: 'parent' }) }, sessions: sessionLookup('user-1'), auditLogs: {}, alerts: { queryPage: jest.fn().mockResolvedValue({ items: [{ id: 'alert-1' }], lastEvaluatedKey: { id: 'next', user_id: 'user-1' } }) } },
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  };
  const app = createApp({ services, config: { corsOrigins: [] } });
  const auth = authHeader();
  const response = await request(app).get('/api/alerts?limit=20').set(auth);
  expect(response.status).toBe(200);
  expect(response.body).toEqual([{ id: 'alert-1' }]);
  expect(response.headers['x-next-cursor']).toBeTruthy();
  const badCursor = Buffer.from(JSON.stringify([])).toString('base64url');
  expect((await request(app).get(`/api/alerts?cursor=${badCursor}`).set(auth)).status).toBe(400);
  const extraKeyCursor = Buffer.from(JSON.stringify({ id: 'x', user_id: 'user-1', extra: 'x' })).toString('base64url');
  expect((await request(app).get(`/api/alerts?cursor=${extraKeyCursor}`).set(auth)).status).toBe(400);
  services.models.users.get.mockResolvedValue({ id: 'admin-1', role: 'admin' });
  expect((await request(app).get('/api/alerts').set(auth)).status).toBe(403);
});
