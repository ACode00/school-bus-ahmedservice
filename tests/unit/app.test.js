const request = require('supertest');
const { createApp } = require('../../app');

function makeLogger() {
  return { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
}

describe('HTTP app foundation', () => {
  test('GET /health returns a public health response', async () => {
    const app = createApp({ services: { logger: makeLogger() }, config: { corsOrigins: [] } });

    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
  });

  test('unknown paths use the standardized JSON error envelope', async () => {
    const app = createApp({ services: { logger: makeLogger() }, config: { corsOrigins: [] } });

    const response = await request(app).get('/not-a-route');

    expect(response.status).toBe(404);
    expect(response.body.error).toMatchObject({ code: 'NOT_FOUND' });
  });

  test('CORS allows configured origins and rejects unlisted origins', async () => {
    const app = createApp({
      services: { logger: makeLogger() },
      config: { corsOrigins: ['https://parents.example.test'] },
    });

    const allowed = await request(app).get('/health').set('Origin', 'https://parents.example.test');
    const rejected = await request(app).get('/health').set('Origin', 'https://attacker.example.test');

    expect(allowed.headers['access-control-allow-origin']).toBe('https://parents.example.test');
    expect(allowed.headers['access-control-expose-headers']).toContain('X-Cache');
    expect(rejected.status).toBe(403);
  });

  test('request and response logs are structured and redact authorization headers', async () => {
    const logger = makeLogger();
    const app = createApp({ services: { logger }, config: { corsOrigins: [] } });

    await request(app).get('/health').set('Authorization', 'Bearer do-not-log-this');

    const serialized = JSON.stringify([...logger.info.mock.calls, ...logger.warn.mock.calls, ...logger.error.mock.calls]);
    expect(serialized).toContain('request');
    expect(serialized).toContain('response');
    expect(serialized).not.toContain('do-not-log-this');
  });
});
