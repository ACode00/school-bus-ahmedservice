const { getTableDefinitions } = require('../../scripts/provision/dynamodb');
const dynamodbProvisioner = require('../../scripts/provision/dynamodb');

describe('DynamoDB bootstrap definitions', () => {
  test('defines all report and internal tables with the required key schemas', () => {
    const definitions = getTableDefinitions();
    const byName = Object.fromEntries(definitions.map((table) => [table.TableName, table]));

    expect(definitions).toHaveLength(14);
    expect(byName.TripStops.KeySchema).toEqual([
      { AttributeName: 'trip_id', KeyType: 'HASH' },
      { AttributeName: 'stop_id', KeyType: 'RANGE' },
    ]);
    expect(byName.Users.GlobalSecondaryIndexes.map((index) => index.IndexName)).toContain('email-index');
    expect(byName.IdentityClaims.KeySchema).toEqual([{ AttributeName: 'identity_store_user_id', KeyType: 'HASH' }]);
    expect(byName.NotificationOutbox.GlobalSecondaryIndexes[0].KeySchema).toEqual([
      { AttributeName: 'status', KeyType: 'HASH' },
      { AttributeName: 'created_at', KeyType: 'RANGE' },
    ]);
    expect(dynamodbProvisioner.provision).toBe(dynamodbProvisioner.provisionDynamoDB);
  });
});
