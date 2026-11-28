const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const bcrypt = require('bcryptjs');
const { TransactWriteCommand } = require('@aws-sdk/lib-dynamodb');
const { loadConfig } = require('../config/env');
const { createAwsClients } = require('../config/aws-clients');
const { createModels } = require('../models');

const routeFixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'seed-data/routes.json'), 'utf8'));

function getSeedConfig(env = process.env) {
  if (env.SEED_SAMPLE_DATA !== 'true') return null;
  const accounts = {};
  for (const role of ['admin', 'supervisor', 'parent']) {
    const prefix = `SEED_${role.toUpperCase()}`;
    const email = env[`${prefix}_EMAIL`]?.trim().toLowerCase();
    const password = env[`${prefix}_PASSWORD`];
    const name = env[`${prefix}_NAME`]?.trim() || role;
    if (!email || !password || Buffer.byteLength(password, 'utf8') < 8 || Buffer.byteLength(password, 'utf8') > 72) throw new Error(`${prefix}_EMAIL and an 8-72 byte ${prefix}_PASSWORD are required`);
    accounts[role] = { email, password, name, role };
  }
  return accounts;
}

function isConditionalConflict(error) {
  return ['ConditionalCheckFailedException', 'TransactionCanceledException'].includes(error?.name);
}

async function seedAccount({ account, db, models }) {
  const existingClaim = await models.userEmails.get({ email: account.email });
  if (existingClaim) {
    const existingUser = await models.users.get({ id: existingClaim.user_id });
    if (!existingUser || existingUser.role !== account.role) {
      throw new Error(`Seed email ${account.email} is already assigned to a different role`);
    }
    return existingUser;
  }

  const user = {
    id: crypto.randomUUID(), name: account.name, email: account.email,
    password_hash: await bcrypt.hash(account.password, 12),
    role: account.role,
    created_at: new Date().toISOString(),
  };
  try {
    await db.send(new TransactWriteCommand({
      TransactItems: [
        { Put: { TableName: models.userEmails.tableName, Item: { email: account.email, user_id: user.id, created_at: user.created_at }, ConditionExpression: 'attribute_not_exists(#email)', ExpressionAttributeNames: { '#email': 'email' } } },
        { Put: { TableName: models.users.tableName, Item: user, ConditionExpression: 'attribute_not_exists(#id)', ExpressionAttributeNames: { '#id': 'id' } } },
      ],
    }));
    return user;
  } catch (error) {
    if (!isConditionalConflict(error)) throw error;
    const claim = await models.userEmails.get({ email: account.email });
    const winner = claim && await models.users.get({ id: claim.user_id });
    if (winner?.role === account.role) return winner;
    throw new Error(`Seed email ${account.email} was claimed concurrently`);
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

async function seedSchoolData({ accounts, db, models }) {
  const users = {};
  for (const role of ['admin', 'supervisor', 'parent']) {
    users[role] = await seedAccount({ account: accounts[role], db, models });
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

  return { users: Object.fromEntries(Object.entries(users).map(([role, user]) => [role, user.id])), route_id: route.id };
}

async function seedSampleData({ env = process.env, clients, models } = {}) {
  const accounts = getSeedConfig(env);
  if (!accounts) return { skipped: true };
  if (!clients?.dynamo || !models) throw new Error('Floci clients and models are required when sample seeding is enabled');
  const result = await seedSchoolData({ accounts, db: clients.dynamo, models });
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
