const { createApp } = require('./app');
const { loadConfig } = require('./config/env');
const { createLogger } = require('./config/logger');
const { createAwsClients } = require('./config/aws-clients');
const { createModels } = require('./models');
const { AuditService } = require('./services/audit.service');
const { CacheService } = require('./services/cache.service');
const { createRedisClient } = require('./services/redis-client');

const config = loadConfig(process.env);
const clients = createAwsClients(config);
const logger = createLogger({ cloudWatchLogs: clients.cloudWatchLogs, logGroupName: config.logGroupName, logStreamName: config.logStreamName });
const redis = createRedisClient(config, logger);
let server;

async function start() {
  await redis.connect();
  const models = createModels({ client: clients.dynamo });
  const auditService = new AuditService({ model: models.auditLogs, logger, cloudWatchLogs: clients.cloudWatchLogs, logGroupName: config.logGroupName, logStreamName: config.logStreamName });
  const cache = new CacheService({ client: redis, defaultTtlMs: config.cacheTtlMs, logger });
  const app = createApp({
    config,
    services: { ...clients, db: clients.dynamo, models, auditService, cache, logger },
  });
  server = app.listen(config.port, () => logger.info({ event: 'server_started', port: config.port, cache_backend: 'elasticache' }));
}

async function shutdown(signal) {
  logger.info({ event: 'server_shutdown', signal });
  if (server) server.close();
  if (redis.isOpen) await redis.quit();
  clients.dynamoClient.destroy();
  clients.sqs.destroy();
  clients.cloudWatchLogs.destroy();
  clients.iam.destroy();
  clients.ecs.destroy();
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
start().catch((error) => {
  logger.error({ event: 'server_start_failed', message: error.message });
  process.exitCode = 1;
});
