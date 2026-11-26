const request = require('supertest');
const { TransactWriteCommand } = require('@aws-sdk/lib-dynamodb');
const { createApp } = require('../../app');

function setup(role = 'supervisor') {
  const models = {
    users: { tableName: 'Users', get: jest.fn().mockResolvedValue({ id: role === 'parent' ? 'parent-1' : `${role}-1`, role }) }, identityClaims: { get: jest.fn().mockResolvedValue({ user_id: role === 'parent' ? 'parent-1' : `${role}-1` }) }, auditLogs: { tableName: 'AuditLogs' },
    attendance: { tableName: 'Attendance', get: jest.fn(), findByTripId: jest.fn().mockResolvedValue([]), queryPage: jest.fn().mockResolvedValue({ items: [], lastEvaluatedKey: null }), create: jest.fn(), update: jest.fn() },
    notificationOutbox: { tableName: 'NotificationOutbox' },
    trips: { get: jest.fn().mockResolvedValue({ id: 'trip-1', bus_id: 'bus-1', route_id: 'route-1' }) },
    buses: { findBySupervisorId: jest.fn().mockResolvedValue([{ id: 'bus-1' }]) },
    students: { get: jest.fn().mockResolvedValue({ id: 'student-1', parent_id: 'parent-1', bus_id: 'bus-1' }), findByParentId: jest.fn().mockResolvedValue([{ id: 'student-1' }]) },
  };
  const services = {
    db: { send: jest.fn().mockResolvedValue({}) }, models,
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
    auditService: { record: jest.fn().mockResolvedValue({}) },
    idFactory: () => 'attendance-1', now: () => '2026-11-26T10:00:00.000Z',
  };
  return { app: createApp({ services, config: { corsOrigins: [], sessionTtlSeconds: 28800 } }), services };
}
const authFor = (role = 'supervisor') => ({ 'X-IAM-User-Arn': `arn:aws:sts::000000000000:assumed-role/AWSReservedSSO_BusTracker${role === 'supervisor' ? 'Coordinators' : role === 'parent' ? 'Parents' : 'Admins'}_abc/${role === 'parent' ? 'parent-1' : `${role}-1`}` });
const auth = authFor();

test('supervisor marks own-bus attendance and atomically queues a parent notification', async () => {
  const { app, services } = setup();
  const response = await request(app).post('/api/trips/trip-1/attendance').set(auth).send({ student_id: 'student-1', date: '2026-11-26', status: 'boarded' });
  expect(response.status).toBe(201);
  const tx = services.db.send.mock.calls[0][0];
  expect(tx).toBeInstanceOf(TransactWriteCommand);
  expect(tx.input.TransactItems).toHaveLength(2);
  expect(tx.input.TransactItems[1].Put.Item).toMatchObject({ type: 'ATTENDANCE_MARKED', user_ids: ['parent-1'], status: 'PENDING' });
  expect(services.auditService.record).toHaveBeenCalledWith(expect.objectContaining({ event: 'attendance_marked', status: 'success' }));
});

test('rejects attendance on another supervisor bus and invalid status', async () => {
  const otherBus = setup(); otherBus.services.models.buses.findBySupervisorId.mockResolvedValue([{ id: 'different-bus' }]);
  expect((await request(otherBus.app).post('/api/trips/trip-1/attendance').set(auth).send({ student_id: 'student-1', date: '2026-11-26', status: 'boarded' })).status).toBe(403);
  expect(otherBus.services.auditService.record).toHaveBeenCalledWith(expect.objectContaining({ event: 'ownership_denied', status: 'failure' }));
  const invalid = setup();
  expect((await request(invalid.app).post('/api/trips/trip-1/attendance').set(auth).send({ student_id: 'student-1', date: '2026-11-26', status: 'late' })).status).toBe(400);
  expect((await request(invalid.app).post('/api/trips/trip-1/attendance').set(auth).send({ student_id: 'student-1', date: '2026-99-99', status: 'boarded' })).status).toBe(400);
});

test('parent only sees own child attendance and other child records are hidden as 404', async () => {
  const { app, services } = setup('parent');
  services.models.attendance.queryPage.mockResolvedValue({ items: [{ id: 'a1', trip_id: 'trip-1', student_id: 'other-student', status: 'boarded' }], lastEvaluatedKey: null });
  const response = await request(app).get('/api/trips/trip-1/attendance').set(authFor('parent'));
  expect(response.status).toBe(404);
});

test('supervisor can correct own-bus attendance but cannot correct another bus record', async () => {
  const { app, services } = setup();
  services.models.attendance.get.mockResolvedValue({ id: 'attendance-1', trip_id: 'trip-1', student_id: 'student-1' });
  const ok = await request(app).patch('/api/attendance/attendance-1').set(auth).send({ status: 'dropped' });
  expect(ok.status).toBe(200);
  services.models.buses.findBySupervisorId.mockResolvedValue([{ id: 'bus-other' }]);
  const denied = await request(app).patch('/api/attendance/attendance-1').set(auth).send({ status: 'boarded' });
  expect(denied.status).toBe(403);
});

test('unauthenticated requests return 401 and parents cannot mark attendance', async () => {
  const { app } = setup('parent');
  expect((await request(app).post('/api/trips/trip-1/attendance').send({})).status).toBe(401);
  expect((await request(app).post('/api/trips/trip-1/attendance').set(authFor('parent')).send({})).status).toBe(403);
});

test('does not allow attendance for a cancelled trip or invalid calendar date', async () => {
  const { app, services } = setup();
  const invalidDate = await request(app).post('/api/trips/trip-1/attendance').set(auth).send({ student_id: 'student-1', date: '2026-02-30', status: 'boarded' });
  expect(invalidDate.status).toBe(400);
  services.models.trips.get.mockResolvedValue({ id: 'trip-1', bus_id: 'bus-1', status: 'cancelled', cancelled_date: '2026-11-26' });
  const cancelled = await request(app).post('/api/trips/trip-1/attendance').set(auth).send({ student_id: 'student-1', date: '2026-11-26', status: 'boarded' });
  expect(cancelled.status).toBe(409);
});
