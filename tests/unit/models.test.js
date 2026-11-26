const { DeleteCommand, GetCommand, QueryCommand, PutCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { BaseModel } = require('../../models/base-model');
const { createModels } = require('../../models');
const { TABLE_NAMES } = require('../../config/table-names');
const { createAwsClients, assertLocalEndpoint } = require('../../config/aws-clients');

describe('DynamoDB model helpers', () => {
  test('queries a configured index with aliased names and bound values', async () => {
    const client = { send: jest.fn().mockResolvedValue({ Items: [{ id: 'r-1' }] }) };
    const model = new BaseModel({
      client,
      tableName: 'Routes',
      partitionKey: 'id',
      indexes: { name: 'name-index' },
    });

    const rows = await model.queryBy('name', 'Route #1');

    expect(rows).toEqual([{ id: 'r-1' }]);
    const command = client.send.mock.calls[0][0];
    expect(command).toBeInstanceOf(QueryCommand);
    expect(command.input).toMatchObject({
      TableName: 'Routes',
      IndexName: 'name-index',
      KeyConditionExpression: '#lookup = :lookup',
      ExpressionAttributeNames: { '#lookup': 'name' },
      ExpressionAttributeValues: { ':lookup': 'Route #1' },
    });
  });

  test('creates an item with a conditional primary-key expression', async () => {
    const client = { send: jest.fn().mockResolvedValue({}) };
    const model = new BaseModel({ client, tableName: 'Users', partitionKey: 'id' });

    await model.create({ id: 'u-1', name: 'A' });

    const command = client.send.mock.calls[0][0];
    expect(command).toBeInstanceOf(PutCommand);
    expect(command.input.ConditionExpression).toBe('attribute_not_exists(#pk)');
    expect(command.input.ExpressionAttributeNames).toEqual({ '#pk': 'id' });
  });

  test('gets items using the configured table and key', async () => {
    const client = { send: jest.fn().mockResolvedValue({ Item: { id: 'u-1' } }) };
    const model = new BaseModel({ client, tableName: 'Users' });

    expect(await model.get({ id: 'u-1' })).toEqual({ id: 'u-1' });
    expect(client.send.mock.calls[0][0]).toBeInstanceOf(GetCommand);
  });

  test('updates only non-key fields through aliased expressions', async () => {
    const client = { send: jest.fn().mockResolvedValue({ Attributes: { id: 'u-1', name: 'New' } }) };
    const model = new BaseModel({ client, tableName: 'Users' });

    await model.update({ id: 'u-1' }, { name: 'New', 'status #reserved': 'active', id: 'ignored' });

    const command = client.send.mock.calls[0][0];
    expect(command).toBeInstanceOf(UpdateCommand);
    expect(command.input.UpdateExpression).toBe('SET #field0 = :value0, #field1 = :value1');
    expect(command.input.ExpressionAttributeNames).toMatchObject({ '#field0': 'name', '#field1': 'status #reserved' });
    expect(command.input.ExpressionAttributeValues).toEqual({ ':value0': 'New', ':value1': 'active' });
  });

  test('deletes an item by its parameterized key', async () => {
    const client = { send: jest.fn().mockResolvedValue({ Attributes: { id: 'u-1' } }) };
    const model = new BaseModel({ client, tableName: 'Users' });

    expect(await model.delete({ id: 'u-1' })).toEqual({ id: 'u-1' });
    expect(client.send.mock.calls[0][0]).toBeInstanceOf(DeleteCommand);
  });

  test('returns a bounded index page and continuation key', async () => {
    const lastEvaluatedKey = { id: 'r-2' };
    const client = { send: jest.fn().mockResolvedValue({ Items: [{ id: 'r-1' }], LastEvaluatedKey: lastEvaluatedKey }) };
    const model = new BaseModel({ client, tableName: 'Routes', indexes: { area: 'area-index' } });

    const page = await model.queryPage('area', 'north', { limit: 1 });

    expect(page).toEqual({ items: [{ id: 'r-1' }], lastEvaluatedKey });
    expect(client.send.mock.calls[0][0].input.Limit).toBe(1);
  });

  test('each domain model exposes its declared GSI lookups', async () => {
    const client = { send: jest.fn().mockResolvedValue({ Items: [] }) };
    const models = createModels({ client });
    const expectedLookups = {
      users: ['email'],
      identityClaims: [],
      routes: ['name', 'area'],
      stops: ['route_id'],
      buses: ['route_id', 'supervisor_id'],
      trips: ['route_id'],
      students: ['parent_id', 'bus_id'],
      attendance: ['student_id', 'trip_id'],
      favorites: ['user_id'],
      alerts: ['user_id'],
      holidays: ['date', 'year'],
      auditLogs: ['user_id'],
    };

    for (const [modelName, attributes] of Object.entries(expectedLookups)) {
      for (const attribute of attributes) {
        expect(models[modelName].indexes[attribute]).toBeTruthy();
      }
    }
    expect(TABLE_NAMES).toHaveProperty('notificationOutbox', 'NotificationOutbox');
    expect(models.tripStops.sortKey).toBe('stop_id');

    client.send.mockClear();
    await models.users.findByEmail('parent@example.test');
    expect(client.send.mock.calls[0][0]).toBeInstanceOf(QueryCommand);
    expect(client.send.mock.calls[0][0].input.IndexName).toBe('email-index');
    client.send.mockClear();
    await models.notificationOutbox.findPending('PENDING', { sortKey: { attribute: 'created_at', value: '2026-01-01' } });
    expect(client.send.mock.calls[0][0].input.IndexName).toBe('status-created-at-index');
  });

  test('rejects a lookup that is not backed by a configured index', async () => {
    const client = { send: jest.fn() };
    const model = new BaseModel({ client, tableName: 'Users', partitionKey: 'id', indexes: { email: 'email-index' } });

    await expect(model.queryBy('password_hash', 'secret')).rejects.toThrow('No index configured for password_hash');
    expect(client.send).not.toHaveBeenCalled();
  });

  test('refuses public endpoints and uses fake credentials by default', async () => {
    expect(() => assertLocalEndpoint('https://aws.amazon.com')).toThrow('Refusing non-local AWS endpoint');
    expect(assertLocalEndpoint('http://floci:4566')).toBe('http://floci:4566');
    const clients = createAwsClients({});
    expect(await clients.dynamo.config.credentials()).toMatchObject({ accessKeyId: 'test', secretAccessKey: 'test' });
    for (const clientName of ['ssoAdmin', 'identityStore', 'ssoOidc', 'ssoPortal', 'apiGateway']) {
      expect(clients[clientName]).toBeDefined();
    }
  });
});
