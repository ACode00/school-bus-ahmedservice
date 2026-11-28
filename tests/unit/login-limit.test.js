const request = require('supertest');
const { createApp } = require('../../app');
const { LoginLimiter, MemoryStore, RedisStore } = require('../../services/login-limiter.service');
const { PutMetricFilterCommand } = require('@aws-sdk/client-cloudwatch-logs');
const { PutMetricAlarmCommand } = require('@aws-sdk/client-cloudwatch');
const logsProvisioner = require('../../scripts/provision/cloudwatch');

function makeServices() {
  const users = new Map();
  const emails = new Map();
  const sessions = new Map();
  return {
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
    db: { send: jest.fn(async (command) => {
      for (const tx of command.input.TransactItems) {
        const item = tx.Put.Item;
        if (tx.Put.TableName === 'Users') users.set(item.id, item);
        if (tx.Put.TableName === 'UserEmails') emails.set(item.email, item.user_id);
      }
    }) },
    models: {
      users: { tableName: 'Users', get: jest.fn(async ({ id }) => users.get(id) || null) },
      userEmails: { tableName: 'UserEmails', get: jest.fn(async ({ email }) => (emails.has(email) ? { user_id: emails.get(email) } : null)) },
      sessions: {
        tableName: 'Sessions',
        create: jest.fn(async (session) => { sessions.set(session.token_hash, session); return session; }),
        get: jest.fn(async ({ id }) => sessions.get(id) || null),
        delete: jest.fn(async () => {}),
      },
      routes: {}, stops: {}, buses: {}, trips: {}, tripStops: {}, students: {}, attendance: {},
      notificationOutbox: {}, auditLogs: { create: jest.fn() },
    },
    auditService: { record: jest.fn().mockResolvedValue({}) },
    cache: { getOrLoad: async (_key, load) => ({ value: await load(), cacheStatus: 'MISS' }) },
  };
}

const config = { corsOrigins: [] };
const login = (app, email, password) => request(app).post('/api/sessions').send({ email, password });

async function appWithUser() {
  const services = makeServices();
  const app = createApp({ services, config });
  await request(app).post('/api/users').send({ name: 'Mina Parent', email: 'mina@example.test', password: 'secure-password' });
  return { app, services };
}

test('3 wrong passwords, then the 4th try is blocked with 429 and Retry-After, even with the right password', async () => {
  const { app } = await appWithUser();
  for (let i = 0; i < 3; i += 1) expect((await login(app, 'mina@example.test', 'wrong-password')).status).toBe(401);
  const blocked = await login(app, 'mina@example.test', 'secure-password');
  expect(blocked.status).toBe(429);
  expect(blocked.body.error.code).toBe('TOO_MANY_LOGIN_ATTEMPTS');
  expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
});

test('a correct login before the limit resets the count', async () => {
  const { app } = await appWithUser();
  await login(app, 'mina@example.test', 'wrong-password');
  await login(app, 'mina@example.test', 'wrong-password');
  expect((await login(app, 'mina@example.test', 'secure-password')).status).toBe(200);
  await login(app, 'mina@example.test', 'wrong-password');
  await login(app, 'mina@example.test', 'wrong-password');
  expect((await login(app, 'mina@example.test', 'secure-password')).status).toBe(200);
});

test('a wrong email and a wrong password give the same 401 answer', async () => {
  const { app } = await appWithUser();
  const wrongPassword = await login(app, 'mina@example.test', 'wrong-password');
  const unknownEmail = await login(app, 'nobody@example.test', 'wrong-password');
  expect(wrongPassword.status).toBe(401);
  expect(unknownEmail.status).toBe(401);
  expect(unknownEmail.body).toEqual(wrongPassword.body);
});

test('blocked and refused logins are logged as SECURITY lines without the password', async () => {
  const { app, services } = await appWithUser();
  for (let i = 0; i < 4; i += 1) await login(app, 'mina@example.test', 'wrong-password');
  const lines = services.logger.warn.mock.calls.map(([event]) => event).filter((event) => event.event === 'SECURITY');
  expect(lines.map((line) => line.status)).toEqual([401, 401, 401, 429]);
  expect(lines[3]).toMatchObject({ reason: 'TOO_MANY_LOGIN_ATTEMPTS', method: 'POST', path: '/api/sessions' });
  expect(JSON.stringify(services.logger.warn.mock.calls)).not.toContain('wrong-password');
});

test('the memory store forgets failures after the window ends', async () => {
  let now = 0;
  const limiter = new LoginLimiter({ store: new MemoryStore(() => now), maxFailures: 3, windowSeconds: 600 });
  for (let i = 0; i < 3; i += 1) await limiter.recordFailure('a@example.test', '1.1.1.1');
  expect((await limiter.check('a@example.test', '1.1.1.1')).blocked).toBe(true);
  now = 601 * 1000;
  expect((await limiter.check('a@example.test', '1.1.1.1')).blocked).toBe(false);
});

test('when turned on, the IP limit blocks one IP after 10 failures across different emails', async () => {
  const limiter = new LoginLimiter({ maxIpFailures: 10 });
  for (let i = 0; i < 10; i += 1) await limiter.recordFailure(`user${i}@example.test`, '2.2.2.2');
  expect((await limiter.check('new@example.test', '2.2.2.2')).blocked).toBe(true);
  expect((await limiter.check('new@example.test', '3.3.3.3')).blocked).toBe(false);
});

test('the IP limit is off by default, so users behind the same gateway are not locked out together', async () => {
  const limiter = new LoginLimiter();
  for (let i = 0; i < 20; i += 1) await limiter.recordFailure(`user${i}@example.test`, '10.0.0.1');
  expect((await limiter.check('someone-else@example.test', '10.0.0.1')).blocked).toBe(false);
});

test('the Redis store sets the window only on the first failure', async () => {
  const client = { incr: jest.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(2), expire: jest.fn(), get: jest.fn(), ttl: jest.fn(), del: jest.fn() };
  const store = new RedisStore(client);
  await store.incr('k', 600);
  await store.incr('k', 600);
  expect(client.expire).toHaveBeenCalledTimes(1);
  expect(client.expire).toHaveBeenCalledWith('k', 600);
});

test('if Redis fails, logins still work (fail open on the limiter only, bcrypt still checks the password)', async () => {
  const broken = { get: jest.fn().mockRejectedValue(new Error('down')), ttl: jest.fn(), incr: jest.fn().mockRejectedValue(new Error('down')), del: jest.fn().mockRejectedValue(new Error('down')) };
  const limiter = new LoginLimiter({ store: broken });
  expect((await limiter.check('a@example.test', '1.1.1.1')).blocked).toBe(false);
  await expect(limiter.recordFailure('a@example.test', '1.1.1.1')).resolves.toBeUndefined();
});

test('CloudWatch provisioning creates the SECURITY and 5xx metric filters and their alarms', async () => {
  const cloudWatchLogs = { send: jest.fn().mockImplementation((command) => Promise.resolve(command.constructor.name === 'DescribeLogStreamsCommand' ? { logStreams: [] } : {})) };
  const cloudWatch = { send: jest.fn().mockResolvedValue({}) };
  const result = await logsProvisioner.provision({ cloudWatchLogs, cloudWatch });
  const filters = cloudWatchLogs.send.mock.calls.map(([cmd]) => cmd).filter((cmd) => cmd instanceof PutMetricFilterCommand);
  expect(filters.map((cmd) => cmd.input.filterPattern)).toEqual(['SECURITY', '"Request failed"']);
  const alarms = cloudWatch.send.mock.calls.map(([cmd]) => cmd).filter((cmd) => cmd instanceof PutMetricAlarmCommand);
  expect(alarms.map((cmd) => cmd.input.AlarmName)).toEqual(['schedule-arrival-security-denied', 'schedule-arrival-server-errors']);
  expect(result.alarms).toHaveLength(2);
});
