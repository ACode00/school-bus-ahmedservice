const crypto = require('node:crypto');
const { loadConfig } = require('../../config/env');
const { createAwsClients } = require('../../config/aws-clients');
const { createModels } = require('../../models');
const { NotificationService } = require('../../services/notification.service');

const enabled = process.env.RUN_FLOCI_INTEGRATION === '1';
(enabled ? describe : describe.skip)('notification queue against Floci', () => {
  test('publishes outbox events and creates a parent alert before deleting the SQS message', async () => {
    const config = loadConfig(process.env); const clients = createAwsClients(config); const models = createModels({ client: clients.dynamo });
    const suffix = crypto.randomUUID(); const parentId = `parent-${suffix}`; const eventId = `event-${suffix}`;
    const service = new NotificationService({ sqs: clients.sqs, models, queueUrl: config.queueUrl, queueName: config.queueName, endpoint: clients.endpoint, logger: { info: jest.fn(), error: jest.fn() } });
    try {
      await models.users.create({ id: parentId, name: 'Queue Integration Parent', email: `${parentId}@example.test`, role: 'parent', password_hash: 'unused' });
      await models.notificationOutbox.create({ id: eventId, status: 'PENDING', created_at: new Date().toISOString(), type: 'ATTENDANCE_UPDATED', user_ids: [parentId], student_id: 'student-x', trip_id: 'trip-x', message: 'Student boarded' });
      expect(await service.publishPending()).toBeGreaterThan(0);
      let alerts = [];
      for (let attempt = 0; attempt < 4 && alerts.length === 0; attempt += 1) {
        await service.pollOnce(); alerts = await models.alerts.findByUserId(parentId);
      }
      expect(alerts).toEqual(expect.arrayContaining([expect.objectContaining({ id: `${eventId}:${parentId}`, type: 'boarding', is_read: false, trip_id: 'trip-x' })]));
      expect(await models.notificationOutbox.get({ id: eventId })).toMatchObject({ status: 'PUBLISHED' });
    } finally {
      const alerts = await models.alerts.findByUserId(parentId); for (const alert of alerts) await models.alerts.delete({ id: alert.id });
      await models.notificationOutbox.delete({ id: eventId }).catch(() => {}); await models.users.delete({ id: parentId }).catch(() => {});
      await clients.dynamoClient.destroy();
    }
  });
});
