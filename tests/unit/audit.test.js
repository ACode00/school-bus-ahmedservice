const { PutLogEventsCommand } = require('@aws-sdk/client-cloudwatch-logs');
const { AuditService, recordSafely } = require('../../services/audit.service');
const { createLogger } = require('../../config/logger');

test('audit event persists to DynamoDB and CloudWatch Logs', async () => {
  const model = { create: jest.fn().mockResolvedValue(undefined) };
  const cloudWatchLogs = { send: jest.fn().mockResolvedValue({}) };
  const logger = { info: jest.fn() };
  const service = new AuditService({ model, logger, cloudWatchLogs, now: () => 1000 });
  const event = await service.record({ userId: 'user-1', event: 'attendance_marked', status: 'success' });
  expect(model.create).toHaveBeenCalledWith(expect.objectContaining({ user_id: 'user-1', event: 'attendance_marked', created_at: new Date(1000).toISOString() }));
  expect(cloudWatchLogs.send.mock.calls[0][0]).toBeInstanceOf(PutLogEventsCommand);
  expect(JSON.parse(cloudWatchLogs.send.mock.calls[0][0].input.logEvents[0].message)).toMatchObject({ id: event.id, event: 'attendance_marked', category: 'audit' });
});

test('structured application logger forwards request events to CloudWatch', async () => {
  const cloudWatchLogs = { send: jest.fn().mockResolvedValue({}) };
  const logger = createLogger({ sink: { log: jest.fn(), warn: jest.fn(), error: jest.fn() }, cloudWatchLogs });
  logger.info({ event: 'http_response', status: 200 });
  await new Promise(setImmediate);
  expect(cloudWatchLogs.send.mock.calls[0][0]).toBeInstanceOf(PutLogEventsCommand);
});

test('secondary audit delivery failure is logged without changing a completed response', async () => {
  const logger = { error: jest.fn() };
  await expect(recordSafely({ record: jest.fn().mockRejectedValue(new Error('CloudWatch unavailable')) }, { event: 'attendance_marked' }, logger)).resolves.toBeUndefined();
  expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({ event: 'audit_write_failed', audit_event: 'attendance_marked' }));
});
