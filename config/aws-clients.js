const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
const { SQSClient } = require('@aws-sdk/client-sqs');
const { CloudWatchClient } = require('@aws-sdk/client-cloudwatch');
const { CloudWatchLogsClient } = require('@aws-sdk/client-cloudwatch-logs');
const { IAMClient } = require('@aws-sdk/client-iam');
const { ECSClient } = require('@aws-sdk/client-ecs');
const { ElastiCacheClient } = require('@aws-sdk/client-elasticache');
const { SSOAdminClient } = require('@aws-sdk/client-sso-admin');
const { IdentitystoreClient } = require('@aws-sdk/client-identitystore');
const { SSOOIDCClient } = require('@aws-sdk/client-sso-oidc');
const { SSOClient } = require('@aws-sdk/client-sso');
const { APIGatewayClient } = require('@aws-sdk/client-api-gateway');

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', 'floci']);

function assertLocalEndpoint(endpoint) {
  let parsed;
  try {
    parsed = new URL(endpoint);
  } catch {
    throw new Error('Floci endpoint must be an absolute local URL');
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || !LOCAL_HOSTS.has(parsed.hostname.toLowerCase())) {
    throw new Error(`Refusing non-local AWS endpoint: ${parsed.hostname || endpoint}`);
  }
  return parsed.toString().replace(/\/$/, '');
}

function createAwsClients(config = {}) {
  const configuredEndpoint = config.flociEndpoint ?? config.FLOCI_ENDPOINT ?? config.awsEndpointUrl ?? config.AWS_ENDPOINT_URL ?? 'http://localhost:4566';
  const endpoint = configuredEndpoint ? assertLocalEndpoint(configuredEndpoint) : undefined;
  const shared = {
    region: config.awsRegion || config.AWS_REGION || 'us-east-1',
    maxAttempts: 3,
    ...(endpoint ? { endpoint, credentials: { accessKeyId: 'test', secretAccessKey: 'test' } } : {}),
  };
  const dynamoClient = new DynamoDBClient(shared);
  return {
    endpoint,
    dynamoClient,
    dynamo: DynamoDBDocumentClient.from(dynamoClient),
    sqs: new SQSClient(shared),
    cloudWatchLogs: new CloudWatchLogsClient(shared),
    cloudWatch: new CloudWatchClient(shared),
    iam: new IAMClient(shared),
    ecs: new ECSClient(shared),
    elasticache: new ElastiCacheClient(shared),
    ssoAdmin: new SSOAdminClient(shared),
    identityStore: new IdentitystoreClient(shared),
    ssoOidc: new SSOOIDCClient(shared),
    ssoPortal: new SSOClient(shared),
    apiGateway: new APIGatewayClient(shared),
  };
}

module.exports = { createAwsClients, assertLocalEndpoint, LOCAL_HOSTS };
