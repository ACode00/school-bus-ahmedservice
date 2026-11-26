const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { TransactWriteCommand } = require('@aws-sdk/lib-dynamodb');
const { loadConfig } = require('../config/env');
const { createAwsClients } = require('../config/aws-clients');
const { createModels } = require('../models');
const { DescribeUserCommand } = require('@aws-sdk/client-identitystore');

const routeFixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'seed-data/routes.json'), 'utf8'));
const holidayFixtures = JSON.parse(fs.readFileSync(path.join(__dirname, 'seed-data/holidays.json'), 'utf8'));

function getSeedConfig(env = process.env) {
  if (env.SEED_SAMPLE_DATA !== 'true') return null;
  const accounts = {};
  for (const role of ['admin', 'supervisor', 'parent']) {
    const prefix = `SEED_${role.toUpperCase()}`;
    const identityStoreUserId = env[`${prefix}_IDENTITY_STORE_USER_ID`]?.trim();
    if (!identityStoreUserId) throw new Error(`${prefix}_IDENTITY_STORE_USER_ID is required`);
    accounts[role] = { identityStoreUserId, role };
  }
  return accounts;
}

function isConditionalConflict(error) {
  return ['ConditionalCheckFailedException', 'TransactionCanceledException'].includes(error?.name);
}

async function seedAccount({ account, identityStore, identityStoreId, db, models }) {
  const existingClaim = await models.identityClaims.get({ identity_store_user_id: account.identityStoreUserId });
  if (existingClaim) {
    const existingUser = await models.users.get({ id: existingClaim.user_id });
    if (!existingUser || existingUser.role !== account.role) {
      throw new Error(`Identity Store user ${account.identityStoreUserId} is already assigned to a different role`);
    }
    return existingUser;
  }

  const identity = await identityStore.send(new DescribeUserCommand({ IdentityStoreId: identityStoreId, UserId: account.identityStoreUserId }));
  const email = identity.Emails?.find((entry) => entry.Primary)?.Value || identity.Emails?.[0]?.Value;
  if (!identity.UserId || !email) throw new Error(`Identity Store user ${account.identityStoreUserId} must include an email`);
  const user = {
    id: crypto.randomUUID(), identity_store_user_id: account.identityStoreUserId,
    name: identity.DisplayName || identity.UserName,
    email: email.toLowerCase(),
    role: account.role,
    created_at: new Date().toISOString(),
  };
  try {
    await db.send(new TransactWriteCommand({
      TransactItems: [
        {
          Put: {
            TableName: models.users.tableName,
            Item: user,
            ConditionExpression: 'attribute_not_exists(#id)',
            ExpressionAttributeNames: { '#id': 'id' },
          },
        },
        {
          Put: { TableName: models.identityClaims.tableName, Item: { identity_store_user_id: account.identityStoreUserId, user_id: user.id, created_at: user.created_at }, ConditionExpression: 'attribute_not_exists(#identity)', ExpressionAttributeNames: { '#identity': 'identity_store_user_id' } },
        },
      ],
    }));
    return user;
  } catch (error) {
    if (!isConditionalConflict(error)) throw error;
    const claim = await models.identityClaims.get({ identity_store_user_id: account.identityStoreUserId });
    const winner = claim && await models.users.get({ id: claim.user_id });
    if (winner?.role === account.role) return winner;
    throw new Error(`Identity Store user ${account.identityStoreUserId} was claimed concurrently`);
  }
}

async function ensureItem(model, item, key) {
  const existing = await model.get(key);
  if (existing) return existing;
  try {
    return await model.create(item);
  } catch (error) {
    if (!isConditionalConflict(error)) throw error;
    return model.get(key);
  }
}

async function seedSchoolData({ accounts, identityStore, identityStoreId, db, models }) {
  const users = {};
  for (const role of ['admin', 'supervisor', 'parent']) {
    users[role] = await seedAccount({ account: accounts[role], identityStore, identityStoreId, db, models });
  }

  const fixture = routeFixture;
  const route = fixture.route;
  await ensureItem(models.routes, route, { id: route.id });
  for (const stop of fixture.stops) {
    await ensureItem(models.stops, { ...stop, route_id: route.id }, { id: stop.id });
  }
  const bus = { ...fixture.bus, route_id: route.id, supervisor_id: users.supervisor.id };
  await ensureItem(models.buses, bus, { id: bus.id });
  const trip = { ...fixture.trip, route_id: route.id, bus_id: bus.id };
  await ensureItem(models.trips, trip, { id: trip.id });
  for (const tripStop of fixture.tripStops) {
    const item = { trip_id: trip.id, ...tripStop };
    await ensureItem(models.tripStops, item, { trip_id: trip.id, stop_id: tripStop.stop_id });
  }
  const student = { ...fixture.student, parent_id: users.parent.id, bus_id: bus.id };
  await ensureItem(models.students, student, { id: student.id });
  for (const holiday of holidayFixtures) {
    await ensureItem(models.holidays, holiday, { id: holiday.id });
  }

  return { users: Object.fromEntries(Object.entries(users).map(([role, user]) => [role, user.id])), route_id: route.id };
}

async function seedSampleData({ env = process.env, clients, models } = {}) {
  const accounts = getSeedConfig(env);
  if (!accounts) return { skipped: true };
  if (!clients?.dynamo || !models) throw new Error('Floci clients and models are required when sample seeding is enabled');
  const identityStoreId = env.SSO_IDENTITY_STORE_ID;
  if (!identityStoreId) throw new Error('SSO_IDENTITY_STORE_ID is required when sample seeding is enabled');
  const result = await seedSchoolData({ accounts, identityStore: clients.identityStore, identityStoreId, db: clients.dynamo, models });
  return { skipped: false, ...result };
}

async function main() {
  const config = loadConfig(process.env);
  const clients = createAwsClients(config);
  const models = createModels({ client: clients.dynamo });
  const result = await seedSampleData({ env: process.env, clients, models });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = { getSeedConfig, seedSampleData, seedSchoolData, seedAccount };
