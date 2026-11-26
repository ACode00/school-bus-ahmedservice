const { loadConfig } = require('./config/env');
const { createLogger } = require('./config/logger');
const { createAwsClients } = require('./config/aws-clients');
const { createModels } = require('./models');
const { NotificationService } = require('./services/notification.service');

const config = loadConfig(process.env);
const clients = createAwsClients(config);
const logger = createLogger({ cloudWatchLogs: clients.cloudWatchLogs, logGroupName: config.logGroupName, logStreamName: 'worker' });
const models = createModels({ client: clients.dynamo });
const notificationService = new NotificationService({ sqs: clients.sqs, models, queueUrl: config.queueUrl, queueName: config.queueName, endpoint: clients.endpoint, logger });
const abort = new AbortController();

async function shutdown(signal) {
  logger.info({ event: 'notification_worker_shutdown', signal });
  abort.abort();
  await clients.dynamoClient.destroy();
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
notificationService.run({ signal: abort.signal }).catch((error) => {
  logger.error({ event: 'notification_worker_stopped', message: error.message });
  process.exitCode = 1;
});
