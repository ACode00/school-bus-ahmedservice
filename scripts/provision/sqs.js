const { CreateQueueCommand, GetQueueUrlCommand, GetQueueAttributesCommand } = require('@aws-sdk/client-sqs');

async function provision({ sqs }, config = {}) {
  const queueName = config.queueName || process.env.SQS_QUEUE_NAME || 'bus-tracker-notifications-queue';
  const created = await sqs.send(new CreateQueueCommand({ QueueName: queueName, Attributes: { VisibilityTimeout: '30', ReceiveMessageWaitTimeSeconds: '10' } }));
  const queueUrl = created.QueueUrl || (await sqs.send(new GetQueueUrlCommand({ QueueName: queueName }))).QueueUrl;
  if (!queueUrl) throw new Error(`Unable to resolve SQS queue ${queueName}`);
  const attributes = await sqs.send(new GetQueueAttributesCommand({ QueueUrl: queueUrl, AttributeNames: ['QueueArn'] }));
  return { queueName, queueUrl, queueArn: attributes.Attributes?.QueueArn || null };
}

module.exports = { provision };
