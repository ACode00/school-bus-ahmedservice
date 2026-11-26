require('dotenv').config();

function parseOrigins(value = '') {
  return value.split(',').map((origin) => origin.trim()).filter(Boolean);
}

function loadConfig(env = process.env) {
  const nodeEnv = env.NODE_ENV || 'development';
  const flociEndpoint = env.FLOCI_ENDPOINT || env.AWS_ENDPOINT_URL || (nodeEnv === 'production' ? '' : 'http://localhost:4566');
  const port = Number.parseInt(env.PORT || '3000', 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535');
  }

  return {
    port,
    nodeEnv,
    corsOrigins: parseOrigins(env.CORS_ORIGINS),
    flociEndpoint,
    awsRegion: env.AWS_REGION || 'us-east-1',
    awsAccessKeyId: env.AWS_ACCESS_KEY_ID || 'test',
    awsSecretAccessKey: env.AWS_SECRET_ACCESS_KEY || 'test',
    cacheTtlMs: Number.parseInt(env.CACHE_TTL_MS || '60000', 10),
    cacheUrl: env.CACHE_URL || '',
    cacheHost: env.CACHE_HOST || 'localhost',
    cachePort: Number.parseInt(env.CACHE_PORT || '6379', 10),
    cacheConnectRetries: Number.parseInt(env.CACHE_CONNECT_RETRIES || '5', 10),
    cacheClusterId: env.CACHE_CLUSTER_ID || 'school-bus-tracker-cache',
    cacheEngineVersion: env.CACHE_ENGINE_VERSION || '7.1',
    cacheNodeType: env.CACHE_NODE_TYPE || 'cache.t3.micro',
    cachePollAttempts: Number.parseInt(env.CACHE_POLL_ATTEMPTS || '60', 10),
    cachePollDelayMs: Number.parseInt(env.CACHE_POLL_DELAY_MS || '1000', 10),
    logGroupName: env.CLOUDWATCH_LOG_GROUP || '/school-bus-tracker/backend',
    logStreamName: env.CLOUDWATCH_LOG_STREAM || 'audit',
    queueName: env.SQS_QUEUE_NAME || 'bus-tracker-notifications-queue',
    queueUrl: env.SQS_QUEUE_URL || '',
    ssoInstanceArn: env.SSO_INSTANCE_ARN || '',
    ssoIdentityStoreId: env.SSO_IDENTITY_STORE_ID || '',
    ssoRegion: env.SSO_REGION || env.AWS_REGION || 'us-east-1',
    ssoAccountId: env.SSO_ACCOUNT_ID || env.FLOCI_ACCOUNT_ID || '000000000000',
    apiGatewayId: env.API_GATEWAY_ID || '',
    apiGatewayStage: env.API_GATEWAY_STAGE || 'local',
    apiBackendUrl: env.API_BACKEND_URL || 'http://backend:3000',
    apiGatewayName: env.API_GATEWAY_NAME || 'school-bus-tracker-api',
    apiGatewayInvokeEndpoint: env.API_GATEWAY_INVOKE_ENDPOINT || 'http://localhost:4566',
  };
}

module.exports = { loadConfig, parseOrigins };
