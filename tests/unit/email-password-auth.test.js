const request = require('supertest');
const bcrypt = require('bcryptjs');
const { createApp } = require('../../app');
const { hashToken } = require('../../middleware/require-auth');

function makeServices() {
  const users = new Map();
  const emails = new Map();
  const sessions = new Map();
  return {
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
    db: { send: jest.fn(async (command) => {
      for (const tx of command.input.TransactItems) {
        const item = tx.Put.Item;
        if (tx.Put.TableName === 'UserEmails' && emails.has(item.email)) {
          const conflict = new Error('Conditional request failed');
          conflict.name = 'TransactionCanceledException';
          throw conflict;
        }
        if (tx.Put.TableName === 'Users') users.set(item.id, item);
        if (tx.Put.TableName === 'UserEmails') emails.set(item.email, item.user_id);
      }
    }) },
    models: {
      users: { tableName: 'Users', get: jest.fn(async ({ id }) => users.get(id) || null) },
      userEmails: { tableName: 'UserEmails', get: jest.fn(async ({ email }) => ({ user_id: emails.get(email) })) },
      sessions: {
        tableName: 'Sessions',
        create: jest.fn(async (session) => { sessions.set(session.token_hash, session); return session; }),
        get: jest.fn(async ({ id }) => sessions.get(id) || null),
        delete: jest.fn(async ({ id }) => { for (const [key, session] of sessions) if (session.id === id) sessions.delete(key); }),
      },
      routes: { list: jest.fn().mockResolvedValue([]) }, stops: {}, buses: {}, trips: {}, tripStops: {}, students: {}, attendance: {},
      notificationOutbox: {}, holidays: {}, alerts: {}, auditLogs: { create: jest.fn() },
    },
    auditService: { record: jest.fn().mockResolvedValue({}) },
    cache: { getOrLoad: async (_key, load) => ({ value: await load(), cacheStatus: 'MISS' }) },
  };
}

const config = { corsOrigins: [] };

test('signup writes a bcrypt parent profile to DynamoDB and immediately returns a session', async () => {
  const services = makeServices();
  const response = await request(createApp({ services, config })).post('/api/users').send({ name: 'Mina Parent', email: 'MINA@example.test', password: 'secure-password' });
  expect(response.status).toBe(201);
  expect(response.body.user).toMatchObject({ name: 'Mina Parent', email: 'mina@example.test', role: 'parent' });
  expect(response.body.user).not.toHaveProperty('password_hash');
  expect(response.body.token).toEqual(expect.any(String));
  const user = services.db.send.mock.calls[0][0].input.TransactItems.find((tx) => tx.Put.TableName === 'Users').Put.Item;
  expect(await bcrypt.compare('secure-password', user.password_hash)).toBe(true);
  expect(response.body.expires_at - Math.floor(Date.now() / 1000)).toBeGreaterThan(28790);
});

test('login validates the password and protects API routes with the issued bearer token', async () => {
  const services = makeServices();
  const app = createApp({ services, config });
  const signup = await request(app).post('/api/users').send({ name: 'Mina Parent', email: 'mina@example.test', password: 'secure-password' });
  const login = await request(app).post('/api/sessions').send({ email: 'MINA@example.test', password: 'secure-password' });
  const wrong = await request(app).post('/api/sessions').send({ email: 'mina@example.test', password: 'wrong-password' });
  const beforeLogin = await request(app).get('/api/routes');
  const header = { Authorization: `Bearer ${signup.body.token}` };
  const protectedResponse = await request(app).get('/api/routes').set(header);
  const logout = await request(app).delete('/api/sessions/current').set(header);
  const afterLogout = await request(app).get('/api/routes').set(header);
  expect(login.status).toBe(200);
  expect(wrong.status).toBe(401);
  expect(beforeLogin.status).toBe(401);
  expect(protectedResponse.status).toBe(200);
  expect(logout.status).toBe(204);
  expect(afterLogout.status).toBe(401);
  expect(services.models.sessions.get).toHaveBeenCalledWith({ id: hashToken(signup.body.token) });
});

test('registration rejects privileged role injection and duplicate email', async () => {
  const services = makeServices();
  const app = createApp({ services, config });
  const roleInjection = await request(app).post('/api/users').send({ name: 'Admin', email: 'admin@example.test', password: 'secure-password', role: 'admin' });
  expect(roleInjection.status).toBe(400);
  const first = await request(app).post('/api/users').send({ name: 'Mina Parent', email: 'mina@example.test', password: 'secure-password' });
  const duplicate = await request(app).post('/api/users').send({ name: 'Another Name', email: 'MINA@example.test', password: 'secure-password' });
  expect(first.status).toBe(201);
  expect(duplicate.status).toBe(409);
});
