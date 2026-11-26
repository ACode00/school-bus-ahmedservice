const request = require('supertest');
const { TransactWriteCommand } = require('@aws-sdk/lib-dynamodb');
const { DescribeUserCommand } = require('@aws-sdk/client-identitystore');
const { createApp } = require('../../app');
const { parseIdentityCenterPrincipal } = require('../../middleware/require-auth');

const config = { corsOrigins: [] };
const principalArn = (set, userId) => `arn:aws:sts::000000000000:assumed-role/AWSReservedSSO_BusTracker${set}_abc123/${userId}`;

function authServices({ callerRole = 'admin', targetIdentity } = {}) {
  const currentUser = { id: 'app-caller', name: 'Caller', email: 'caller@example.test', role: callerRole };
  return {
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
    db: { send: jest.fn().mockResolvedValue({}) },
    identityStore: { send: jest.fn(async (command) => {
      if (command instanceof DescribeUserCommand) return {
        UserId: command.input.UserId,
        UserName: 'new.parent',
        DisplayName: 'New Parent',
        Emails: [{ Value: 'new.parent@example.test', Primary: true }],
      };
      return {};
    }) },
    models: {
      users: { tableName: 'Users', get: jest.fn().mockImplementation(async ({ id }) => id === 'app-caller' ? currentUser : null) },
      identityClaims: { tableName: 'IdentityClaims', get: jest.fn().mockImplementation(async ({ identity_store_user_id }) => identity_store_user_id === 'caller-id' ? { identity_store_user_id, user_id: 'app-caller' } : null) },
      routes: { list: jest.fn().mockResolvedValue([]) }, stops: {}, buses: {}, trips: {}, tripStops: {}, students: {}, attendance: {},
      notificationOutbox: {}, holidays: {}, alerts: {}, auditLogs: { tableName: 'AuditLogs', create: jest.fn() },
    },
    auditService: { record: jest.fn().mockResolvedValue({}) },
    cache: { getOrLoad: async (_key, loader) => ({ value: await loader(), cacheStatus: 'MISS' }), invalidatePrefix: jest.fn() },
    targetIdentity,
  };
}

describe('Identity Center gateway authentication', () => {
  test.each([
    [principalArn('Parents', 'identity-parent'), { identityStoreUserId: 'identity-parent', role: 'parent' }],
    [principalArn('Coordinators', 'identity-supervisor'), { identityStoreUserId: 'identity-supervisor', role: 'supervisor' }],
    [principalArn('Admins', 'identity-admin'), { identityStoreUserId: 'identity-admin', role: 'admin' }],
  ])('maps an Identity Center role session to the app role', (arn, expected) => {
    expect(parseIdentityCenterPrincipal(arn)).toEqual(expected);
  });

  test('rejects bearer tokens and missing gateway identity with 401', async () => {
    const services = authServices();
    const app = createApp({ services, config });
    const bearer = await request(app).get('/api/routes').set('Authorization', 'Bearer old-session-token');
    const missing = await request(app).get('/api/routes');
    expect(bearer.status).toBe(401);
    expect(missing.status).toBe(401);
  });

  test('resolves only the profile linked to the gateway role session and rejects a role mismatch', async () => {
    const services = authServices({ callerRole: 'parent' });
    const app = createApp({ services, config });
    const ok = await request(app).get('/api/routes').set('X-IAM-User-Arn', principalArn('Parents', 'caller-id'));
    expect(ok.status).toBe(200);
    expect(services.models.identityClaims.get).toHaveBeenCalledWith({ identity_store_user_id: 'caller-id' });

    const mismatch = await request(app).get('/api/routes').set('X-IAM-User-Arn', principalArn('Admins', 'caller-id'));
    expect(mismatch.status).toBe(403);
    expect(mismatch.body.error.code).toBe('IDENTITY_ROLE_MISMATCH');
  });

  test('unknown Identity Center identity is unauthenticated', async () => {
    const services = authServices();
    const app = createApp({ services, config });
    const response = await request(app).get('/api/routes').set('X-IAM-User-Arn', principalArn('Admins', 'unlinked-id'));
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHENTICATED');
  });

  test('admin links an existing Identity Store user to an app role transactionally', async () => {
    const services = authServices();
    const app = createApp({ services, config });
    const response = await request(app).post('/api/users')
      .set('X-IAM-User-Arn', principalArn('Admins', 'caller-id'))
      .send({ identity_store_user_id: 'new-identity-id', role: 'parent' });
    expect(response.status).toBe(201);
    expect(response.body.user).toMatchObject({ id: expect.any(String), identity_store_user_id: 'new-identity-id', role: 'parent', email: 'new.parent@example.test' });
    expect(response.body.user).not.toHaveProperty('password_hash');
    expect(services.identityStore.send.mock.calls[0][0]).toBeInstanceOf(DescribeUserCommand);
    const transaction = services.db.send.mock.calls[0][0];
    expect(transaction).toBeInstanceOf(TransactWriteCommand);
    expect(transaction.input.TransactItems).toHaveLength(2);
    expect(transaction.input.TransactItems[1].Put.Item).toMatchObject({ identity_store_user_id: 'new-identity-id', user_id: response.body.user.id });
  });

  test('non-admin cannot link profiles and password-session endpoint is removed', async () => {
    const services = authServices({ callerRole: 'parent' });
    const app = createApp({ services, config });
    const link = await request(app).post('/api/users')
      .set('X-IAM-User-Arn', principalArn('Parents', 'caller-id'))
      .send({ identity_store_user_id: 'new-identity-id', role: 'admin' });
    expect(link.status).toBe(403);
    expect(services.db.send).not.toHaveBeenCalled();
    expect((await request(app).post('/api/sessions').send({ email: 'x@example.test', password: 'anything' })).status).toBe(404);
  });
});
