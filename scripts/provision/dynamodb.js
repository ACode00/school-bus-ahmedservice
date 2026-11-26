const {
  CreateTableCommand,
  DescribeTimeToLiveCommand,
  DescribeTableCommand,
  UpdateTimeToLiveCommand,
  ResourceInUseException,
  ResourceNotFoundException,
} = require('@aws-sdk/client-dynamodb');
const { TABLE_NAMES } = require('../../config/table-names');

function index(name, partitionKey, sortKey) {
  return {
    IndexName: name,
    KeySchema: [
      { AttributeName: partitionKey, KeyType: 'HASH' },
      ...(sortKey ? [{ AttributeName: sortKey, KeyType: 'RANGE' }] : []),
    ],
    Projection: { ProjectionType: 'ALL' },
  };
}

function table({ name, partitionKey = 'id', sortKey, indexes = [] }) {
  const keys = new Set([partitionKey, ...(sortKey ? [sortKey] : [])]);
  for (const secondary of indexes) {
    for (const key of secondary.KeySchema) keys.add(key.AttributeName);
  }
  return {
    TableName: name,
    AttributeDefinitions: [...keys].map((AttributeName) => ({ AttributeName, AttributeType: 'S' })),
    KeySchema: [
      { AttributeName: partitionKey, KeyType: 'HASH' },
      ...(sortKey ? [{ AttributeName: sortKey, KeyType: 'RANGE' }] : []),
    ],
    ...(indexes.length ? { GlobalSecondaryIndexes: indexes } : {}),
    BillingMode: 'PAY_PER_REQUEST',
  };
}

function getTableDefinitions() {
  const t = TABLE_NAMES;
  return [
    table({ name: t.users, indexes: [index('email-index', 'email')] }),
    table({ name: t.sessions, indexes: [index('token-hash-index', 'token_hash')] }),
    table({ name: t.userEmails, partitionKey: 'email' }),
    table({ name: t.routes, indexes: [index('name-index', 'name'), index('area-index', 'area')] }),
    table({ name: t.stops, indexes: [index('route-id-index', 'route_id')] }),
    table({ name: t.buses, indexes: [index('route-id-index', 'route_id'), index('supervisor-id-index', 'supervisor_id')] }),
    table({ name: t.trips, indexes: [index('route-id-index', 'route_id')] }),
    table({ name: t.tripStops, partitionKey: 'trip_id', sortKey: 'stop_id' }),
    table({ name: t.students, indexes: [index('parent-id-index', 'parent_id'), index('bus-id-index', 'bus_id')] }),
    table({ name: t.attendance, indexes: [index('student-id-index', 'student_id'), index('trip-id-index', 'trip_id')] }),
    table({ name: t.favorites, indexes: [index('user-id-index', 'user_id')] }),
    table({ name: t.alerts, indexes: [index('user-id-index', 'user_id')] }),
    table({ name: t.holidays, indexes: [index('date-index', 'date'), index('year-index', 'year')] }),
    table({ name: t.auditLogs, indexes: [index('user-id-index', 'user_id')] }),
    table({ name: t.identityClaims, partitionKey: 'identity_store_user_id' }),
    table({
      name: t.notificationOutbox,
      indexes: [index('status-created-at-index', 'status', 'created_at')],
    }),
  ];
}

async function tableExists(client, tableName) {
  try {
    await client.send(new DescribeTableCommand({ TableName: tableName }));
    return true;
  } catch (error) {
    if (error instanceof ResourceNotFoundException || error.name === 'ResourceNotFoundException') return false;
    throw error;
  }
}

async function waitForTable(client, tableName, attempts = 40) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const result = await client.send(new DescribeTableCommand({ TableName: tableName }));
      if (result.Table?.TableStatus === 'ACTIVE') return;
    } catch (error) {
      if (!(error instanceof ResourceNotFoundException) && error.name !== 'ResourceNotFoundException') throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for DynamoDB table ${tableName}`);
}

async function ensureTable(client, definition) {
  if (await tableExists(client, definition.TableName)) return 'exists';
  try {
    await client.send(new CreateTableCommand(definition));
  } catch (error) {
    if (!(error instanceof ResourceInUseException) && error.name !== 'ResourceInUseException') throw error;
  }
  await waitForTable(client, definition.TableName);
  return 'created';
}

async function provisionDynamoDB({ dynamoClient }) {
  const definitions = getTableDefinitions();
  const results = [];
  for (const definition of definitions) {
    results.push({ table: definition.TableName, result: await ensureTable(dynamoClient, definition) });
  }
  const ttl = await dynamoClient.send(new DescribeTimeToLiveCommand({ TableName: TABLE_NAMES.sessions }));
  const ttlDescription = ttl.TimeToLiveDescription || {};
  if (!['ENABLED', 'ENABLING'].includes(ttlDescription.TimeToLiveStatus) || ttlDescription.AttributeName !== 'expires_at') {
    await dynamoClient.send(new UpdateTimeToLiveCommand({
      TableName: TABLE_NAMES.sessions,
      TimeToLiveSpecification: { AttributeName: 'expires_at', Enabled: true },
    }));
  }
  return results;
}

module.exports = { getTableDefinitions, provisionDynamoDB, provision: provisionDynamoDB, ensureTable };
