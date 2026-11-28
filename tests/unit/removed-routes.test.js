const request = require('supertest');
const { createApp } = require('../../app');
const { authHeader, sessionLookup } = require('../helpers/auth');

// Alerts and holidays are served by Ali's Favorites & Alerts service, not this one.
test('alerts and holidays paths are not served here', async () => {
  const services = {
    db: {}, cache: {},
    models: { users: { get: jest.fn().mockResolvedValue({ id: 'user-1', role: 'parent' }) }, sessions: sessionLookup('user-1'), auditLogs: {} },
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  };
  const app = createApp({ services, config: { corsOrigins: [] } });
  const auth = authHeader();
  expect((await request(app).get('/api/alerts').set(auth)).status).toBe(404);
  expect((await request(app).patch('/api/alerts/a1/read').set(auth)).status).toBe(404);
  expect((await request(app).get('/api/holidays?year=2027').set(auth)).status).toBe(404);
});
