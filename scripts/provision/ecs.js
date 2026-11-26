const {
  CreateClusterCommand,
  CreateServiceCommand,
  DescribeServicesCommand,
  RegisterTaskDefinitionCommand,
  UpdateServiceCommand,
} = require('@aws-sdk/client-ecs');

async function ensureCluster(ecs, clusterName) {
  try {
    const result = await ecs.send(new CreateClusterCommand({ clusterName, settings: [{ name: 'containerInsights', value: 'disabled' }] }));
    return result.cluster;
  } catch (error) {
    if (error?.name !== 'ClusterAlreadyExistsException') throw error;
    return { clusterArn: `arn:aws:ecs:${process.env.AWS_REGION || 'us-east-1'}:000000000000:cluster/${clusterName}` };
  }
}

async function ensureService(ecs, { clusterId, serviceName, taskDefinitionArn, desiredCount = 1 }) {
  const described = await ecs.send(new DescribeServicesCommand({ cluster: clusterId, services: [serviceName] }));
  const existing = (described.services || []).find((item) => item.serviceName === serviceName && item.status !== 'INACTIVE');
  return existing
    ? ecs.send(new UpdateServiceCommand({ cluster: clusterId, service: serviceName, taskDefinition: taskDefinitionArn, desiredCount }))
    : ecs.send(new CreateServiceCommand({ cluster: clusterId, serviceName, taskDefinition: taskDefinitionArn, desiredCount, launchType: 'EC2', deploymentConfiguration: { maximumPercent: 200, minimumHealthyPercent: 50 } }));
}

function commonEnvironment({ endpoint, region }) {
  return [
    { name: 'NODE_ENV', value: 'production' },
    { name: 'FLOCI_ENDPOINT', value: endpoint },
    { name: 'AWS_ENDPOINT_URL', value: endpoint },
    { name: 'AWS_REGION', value: region },
    { name: 'AWS_ACCESS_KEY_ID', value: 'test' },
    { name: 'AWS_SECRET_ACCESS_KEY', value: 'test' },
  ];
}

function awsLogs({ logGroup, region, prefix }) {
  return { logDriver: 'awslogs', options: { 'awslogs-group': logGroup, 'awslogs-region': region, 'awslogs-stream-prefix': prefix } };
}

async function provision({ ecs }, config = {}) {
  const region = config.awsRegion || process.env.AWS_REGION || 'us-east-1';
  const account = config.accountId || process.env.FLOCI_ACCOUNT_ID || '000000000000';
  const clusterName = config.clusterName || process.env.ECS_CLUSTER_NAME || 'school-bus-tracker';
  const apiFamily = config.taskDefinitionFamily || process.env.ECS_TASK_FAMILY || 'school-bus-tracker-api';
  const workerFamily = config.workerTaskDefinitionFamily || process.env.ECS_WORKER_TASK_FAMILY || `${apiFamily}-worker`;
  const apiServiceName = config.serviceName || process.env.ECS_SERVICE_NAME || 'school-bus-tracker-api';
  const workerServiceName = config.workerServiceName || process.env.ECS_WORKER_SERVICE_NAME || 'school-bus-tracker-worker';
  const apiContainerName = config.containerName || 'school-bus-tracker-api';
  const image = config.image || process.env.BUS_TRACKER_IMAGE || 'school-bus-tracker-backend:local';
  const endpoint = config.flociEndpoint || process.env.FLOCI_ENDPOINT || process.env.AWS_ENDPOINT_URL || 'http://localhost:4566';
  const logGroup = config.logGroupName || process.env.CLOUDWATCH_LOG_GROUP || '/school-bus-tracker/backend';
  const executionRoleArn = config.executionRoleArn || `arn:aws:iam::${account}:role/BusTrackerEcsExecutionRole`;
  const apiTaskRoleArn = config.apiTaskRoleArn || `arn:aws:iam::${account}:role/BusTrackerApiTaskRole`;
  const workerTaskRoleArn = config.workerTaskRoleArn || `arn:aws:iam::${account}:role/BusTrackerWorkerTaskRole`;
  const desiredCount = Number.isInteger(config.desiredCount) ? config.desiredCount : Number.parseInt(process.env.ECS_DESIRED_COUNT || '1', 10);
  const cluster = await ensureCluster(ecs, clusterName);
  const clusterId = cluster.clusterArn || clusterName;
  const commonTask = { networkMode: 'bridge', requiresCompatibilities: ['EC2'], cpu: '512', memory: '1024', executionRoleArn };
  const api = await ecs.send(new RegisterTaskDefinitionCommand({
    ...commonTask,
    family: apiFamily,
    taskRoleArn: apiTaskRoleArn,
    containerDefinitions: [{
      name: apiContainerName, image, essential: true,
      portMappings: [{ containerPort: 3000, hostPort: 0, protocol: 'tcp' }],
      environment: [
        ...commonEnvironment({ endpoint, region }),
        { name: 'PORT', value: '3000' },
        { name: 'CACHE_URL', value: config.cacheUrl || process.env.CACHE_URL || 'redis://floci:6379' },
        { name: 'API_GATEWAY_AUTH_REQUIRED', value: 'true' },
        { name: 'SSO_IDENTITY_STORE_ID', value: config.ssoIdentityStoreId || process.env.SSO_IDENTITY_STORE_ID || '' },
      ],
      healthCheck: { command: ['CMD-SHELL', 'node -e "fetch(\'http://127.0.0.1:3000/health\').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"'], interval: 30, timeout: 5, retries: 3, startPeriod: 20 },
      logConfiguration: awsLogs({ logGroup, region, prefix: 'api' }),
    }],
  }));
  const worker = await ecs.send(new RegisterTaskDefinitionCommand({
    ...commonTask,
    family: workerFamily,
    taskRoleArn: workerTaskRoleArn,
    containerDefinitions: [{
      name: 'school-bus-tracker-worker', image, essential: true, command: ['node', 'worker.js'],
      environment: [
        ...commonEnvironment({ endpoint, region }),
        { name: 'SQS_QUEUE_NAME', value: config.queueName || process.env.SQS_QUEUE_NAME || 'bus-tracker-notifications-queue' },
        { name: 'CLOUDWATCH_LOG_GROUP', value: logGroup }, { name: 'CLOUDWATCH_LOG_STREAM', value: 'worker' },
      ],
      logConfiguration: awsLogs({ logGroup, region, prefix: 'worker' }),
    }],
  }));
  const apiTaskDefinitionArn = api.taskDefinition.taskDefinitionArn;
  const workerTaskDefinitionArn = worker.taskDefinition.taskDefinitionArn;
  const [apiService, workerService] = await Promise.all([
    ensureService(ecs, { clusterId, serviceName: apiServiceName, taskDefinitionArn: apiTaskDefinitionArn, desiredCount }),
    ensureService(ecs, { clusterId, serviceName: workerServiceName, taskDefinitionArn: workerTaskDefinitionArn, desiredCount }),
  ]);
  return {
    clusterArn: cluster.clusterArn || null,
    apiTaskDefinitionArn,
    workerTaskDefinitionArn,
    apiServiceArn: apiService.service?.serviceArn || null,
    workerServiceArn: workerService.service?.serviceArn || null,
    image,
  };
}

module.exports = { provision, ensureCluster, ensureService };
