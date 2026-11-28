const { ReceiveMessageCommand, DeleteMessageCommand, SendMessageCommand } = require('@aws-sdk/client-sqs');
const { NotificationService } = require('../../services/notification.service');

test('publishes notification outbox event to SQS and marks it published', async () => {
  const sqs = { send: jest.fn().mockResolvedValue({ MessageId: 'message-1' }) };
  const outbox = { update: jest.fn().mockResolvedValue({}) };
  const service = new NotificationService({ sqs, models: { notificationOutbox: outbox }, queueUrl: 'http://localhost/queue', logger: { info: jest.fn() } });
  await service.publish({ id: 'event-1', type: 'ATTENDANCE_UPDATED', parent_id: 'parent-1' });
  expect(sqs.send.mock.calls[0][0]).toBeInstanceOf(SendMessageCommand);
  expect(JSON.parse(sqs.send.mock.calls[0][0].input.MessageBody)).toMatchObject({ id: 'event-1' });
  expect(outbox.update).toHaveBeenCalledWith({ id: 'event-1' }, expect.objectContaining({ status: 'PUBLISHED' }));
});

test('SQS worker writes one alert per parent and deletes only a processed message', async () => {
  const sqs = { send: jest.fn()
    .mockResolvedValueOnce({ Messages: [{ MessageId: 'message-1', ReceiptHandle: 'receipt-1', Body: JSON.stringify({ id: 'event-1', user_ids: ['p1', 'p2'], type: 'ATTENDANCE_UPDATED', message: 'Bus update', trip_id: 't1' }) }] })
    .mockResolvedValueOnce({}) };
  const alerts = { create: jest.fn().mockImplementation(async (item) => item) };
  const service = new NotificationService({ sqs, models: { alerts, notificationOutbox: {} }, queueUrl: 'http://localhost/queue', logger: { info: jest.fn() }, idFactory: (event, user) => `${event}-${user}` });
  await service.pollOnce();
  expect(sqs.send.mock.calls[0][0]).toBeInstanceOf(ReceiveMessageCommand);
  expect(alerts.create).toHaveBeenCalledTimes(2);
  expect(alerts.create.mock.calls[0][0]).toMatchObject({ id: 'event-1-p1', user_id: 'p1', trip_id: 't1', is_read: false });
  expect(sqs.send.mock.calls[1][0]).toBeInstanceOf(DeleteMessageCommand);
});
