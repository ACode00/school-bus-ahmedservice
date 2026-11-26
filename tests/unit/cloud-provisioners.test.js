const { CreateQueueCommand, GetQueueUrlCommand, GetQueueAttributesCommand } = require('@aws-sdk/client-sqs');
const { CreateLogGroupCommand, CreateLogStreamCommand, DescribeLogStreamsCommand } = require('@aws-sdk/client-cloudwatch-logs');
const sqsProvisioner = require('../../scripts/provision/sqs');
const logsProvisioner = require('../../scripts/provision/cloudwatch');

test('SQS provisioner creates the notification queue and returns its ARN', async () => {
  const client = { send: jest.fn().mockImplementation((command) => {
    if (command instanceof CreateQueueCommand) return Promise.resolve({ QueueUrl: 'http://floci:4566/queue' });
    if (command instanceof GetQueueAttributesCommand) return Promise.resolve({ Attributes: { QueueArn: 'arn:aws:sqs:local:queue' } });
    return Promise.resolve({ QueueUrl: 'http://floci:4566/queue' });
  }) };
  await expect(sqsProvisioner.provision({ sqs: client })).resolves.toMatchObject({ queueName: 'bus-tracker-notifications-queue', queueArn: 'arn:aws:sqs:local:queue' });
  expect(client.send.mock.calls.some(([cmd]) => cmd instanceof CreateQueueCommand)).toBe(true);
  expect(client.send.mock.calls.some(([cmd]) => cmd instanceof GetQueueUrlCommand)).toBe(false);
});

test('CloudWatch provisioner creates a group and its audit stream', async () => {
  const client = { send: jest.fn().mockImplementation((command) => {
    if (command instanceof DescribeLogStreamsCommand) return Promise.resolve({ logStreams: [] });
    return Promise.resolve({});
  }) };
  const result = await logsProvisioner.provision({ cloudWatchLogs: client });
  expect(result).toMatchObject({ logGroupName: '/school-bus-tracker/backend', logStreamName: 'audit', group: 'created', stream: 'created' });
  expect(client.send.mock.calls.some(([cmd]) => cmd instanceof CreateLogGroupCommand)).toBe(true);
  expect(client.send.mock.calls.some(([cmd]) => cmd instanceof CreateLogStreamCommand)).toBe(true);
});
