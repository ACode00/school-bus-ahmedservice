const crypto = require('node:crypto');
const request = require('supertest');
const { GetLogEventsCommand } = require('@aws-sdk/client-cloudwatch-logs');
const { createApp } = require('../../app');
const { loadConfig } = require('../../config/env');
const { createAwsClients } = require('../../config/aws-clients');
const { createModels } = require('../../models');
const { AuditService } = require('../../services/audit.service');
const { createLogger } = require('../../config/logger');

const enabled = process.env.RUN_FLOCI_INTEGRATION === '1';
(enabled ? describe : describe.skip)('attendance against Floci', () => {
  test('marks attendance, writes notification outbox, and persists audit in DynamoDB and CloudWatch', async () => {
    const config = loadConfig(process.env); const clients = createAwsClients(config); const models = createModels({ client: clients.dynamo });
    const suffix = crypto.randomUUID(); const id = (prefix) => `${prefix}-${suffix}`;
    const ids = { admin: id('admin'), parent: id('parent'), supervisor: id('supervisor'), route: id('route'), stop: id('stop'), bus: id('bus'), trip: id('trip'), student: id('student') };
    const identityId = `ic-${suffix}`; let auditId;
    const logger = createLogger({ cloudWatchLogs: clients.cloudWatchLogs, logGroupName: config.logGroupName, logStreamName: config.logStreamName });
    const auditService = new AuditService({ model: models.auditLogs, logger, cloudWatchLogs: clients.cloudWatchLogs, logGroupName: config.logGroupName, logStreamName: config.logStreamName });
    try {
      await models.users.create({ id: ids.supervisor, identity_store_user_id: identityId, name: 'Integration Supervisor', email: `${ids.supervisor}@example.test`, role: 'supervisor' });
      await models.identityClaims.create({ identity_store_user_id: identityId, user_id: ids.supervisor });
      await models.users.create({ id: ids.parent, name: 'Integration Parent', email: `${ids.parent}@example.test`, role: 'parent' });
      await models.routes.create({ id: ids.route, code: suffix, name: 'Attendance Route', area: 'Integration' });
      await models.stops.create({ id: ids.stop, route_id: ids.route, name: 'Gate', stop_order: 1 });
      await models.buses.create({ id: ids.bus, plate_number: suffix, route_id: ids.route, supervisor_id: ids.supervisor });
      await models.trips.create({ id: ids.trip, route_id: ids.route, bus_id: ids.bus, run_type: 'morning', status: 'scheduled' });
      await models.students.create({ id: ids.student, name: 'Integration Student', parent_id: ids.parent, stop_id: ids.stop, bus_id: ids.bus });
      const app = createApp({ config, services: { ...clients, db: clients.dynamo, models, logger, auditService } });
      const principalArn = `arn:aws:sts::000000000000:assumed-role/AWSReservedSSO_BusTrackerCoordinators_abc/${identityId}`;
      const response = await request(app).post(`/api/trips/${ids.trip}/attendance`).set('X-IAM-User-Arn', principalArn).send({ student_id: ids.student, date: '2026-11-26', status: 'boarded' });
      expect(response.status).toBe(201);
      expect((await models.attendance.findByTripId(ids.trip)).some((entry) => entry.student_id === ids.student)).toBe(true);
      const outbox = await models.notificationOutbox.list({ limit: 100 });
      expect(outbox.some((entry) => entry.trip_id === ids.trip && entry.type === 'ATTENDANCE_MARKED')).toBe(true);
      const audit = (await models.auditLogs.findByUserId(ids.supervisor)).find((entry) => entry.event === 'attendance_marked');
      expect(audit).toBeDefined(); auditId = audit.id;
      await new Promise((resolve) => setTimeout(resolve, 50));
      const logs = await clients.cloudWatchLogs.send(new GetLogEventsCommand({ logGroupName: config.logGroupName, logStreamName: config.logStreamName, startFromHead: true, limit: 1000 }));
      expect(logs.events.some((entry) => entry.message.includes('attendance_marked') && entry.message.includes(ids.trip))).toBe(true);
    } finally {
      await models.identityClaims.delete({ identity_store_user_id: identityId }).catch(() => {});
      for (const item of (await models.notificationOutbox.list({ limit: 100 })).filter((entry) => entry.trip_id === ids.trip)) await models.notificationOutbox.delete({ id: item.id });
      const attendance = await models.attendance.findByTripId(ids.trip); for (const item of attendance) await models.attendance.delete({ id: item.id });
      await models.students.delete({ id: ids.student }).catch(() => {}); await models.trips.delete({ id: ids.trip }).catch(() => {});
      await models.buses.delete({ id: ids.bus }).catch(() => {}); await models.stops.delete({ id: ids.stop }).catch(() => {});
      await models.routes.delete({ id: ids.route }).catch(() => {}); await models.users.delete({ id: ids.parent }).catch(() => {}); await models.users.delete({ id: ids.supervisor }).catch(() => {});
      if (auditId) logger.info({ event: 'integration_audit_retained', audit_id: auditId });
      await clients.dynamoClient.destroy();
    }
  });
});
