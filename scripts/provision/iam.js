const {
  CreateRoleCommand,
  GetRoleCommand,
  PutRolePolicyCommand,
} = require('@aws-sdk/client-iam');
const { TABLE_NAMES } = require('../../config/table-names');

function isAlreadyExists(error) { return error?.name === 'EntityAlreadyExistsException'; }

async function ensureRole(client, roleName, assumeRolePolicyDocument) {
  try {
    const result = await client.send(new CreateRoleCommand({ RoleName: roleName, AssumeRolePolicyDocument: JSON.stringify(assumeRolePolicyDocument), Description: 'School Bus Route Tracker local ECS task role' }));
    return result.Role;
  } catch (error) {
    if (!isAlreadyExists(error)) throw error;
    const result = await client.send(new GetRoleCommand({ RoleName: roleName }));
    return result.Role;
  }
}

function policyDocument(actions, resources) {
  return { Version: '2012-10-17', Statement: [{ Effect: 'Allow', Action: actions, Resource: resources }] };
}

async function provision({ iam }, config = {}) {
  const region = config.awsRegion || process.env.AWS_REGION || 'us-east-1';
  const account = config.accountId || process.env.FLOCI_ACCOUNT_ID || '000000000000';
  const apiRoleName = config.apiRoleName || 'BusTrackerApiTaskRole';
  const workerRoleName = config.workerRoleName || 'BusTrackerWorkerTaskRole';
  const executionRoleName = config.executionRoleName || 'BusTrackerEcsExecutionRole';
  const queueName = config.queueName || process.env.SQS_QUEUE_NAME || 'bus-tracker-notifications-queue';
  const logGroup = config.logGroupName || process.env.CLOUDWATCH_LOG_GROUP || '/school-bus-tracker/backend';
  const taskTrust = { Version: '2012-10-17', Statement: [{ Effect: 'Allow', Principal: { Service: 'ecs-tasks.amazonaws.com' }, Action: 'sts:AssumeRole' }] };
  const apiRole = await ensureRole(iam, apiRoleName, taskTrust);
  const workerRole = await ensureRole(iam, workerRoleName, taskTrust);
  const executionRole = await ensureRole(iam, executionRoleName, taskTrust);
  const tableArns = Object.values(TABLE_NAMES).flatMap((tableName) => [
    `arn:aws:dynamodb:${region}:${account}:table/${tableName}`,
    `arn:aws:dynamodb:${region}:${account}:table/${tableName}/index/*`,
  ]);
  await iam.send(new PutRolePolicyCommand({
    RoleName: apiRoleName, PolicyName: 'BusTrackerApiLeastPrivilege',
    PolicyDocument: JSON.stringify({ Version: '2012-10-17', Statement: [
      { Effect: 'Allow', Action: ['dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:UpdateItem', 'dynamodb:DeleteItem', 'dynamodb:Query', 'dynamodb:Scan', 'dynamodb:TransactWriteItems'], Resource: tableArns },
      { Effect: 'Allow', Action: ['sqs:GetQueueUrl', 'sqs:SendMessage'], Resource: [`arn:aws:sqs:${region}:${account}:${queueName}`] },
      { Effect: 'Allow', Action: ['logs:CreateLogStream', 'logs:PutLogEvents'], Resource: [`arn:aws:logs:${region}:${account}:log-group:${logGroup}:*`] },
    ] }),
  }));
  const alertsTableArn = `arn:aws:dynamodb:${region}:${account}:table/Alerts`;
  const outboxTableArns = [
    `arn:aws:dynamodb:${region}:${account}:table/NotificationOutbox`,
    `arn:aws:dynamodb:${region}:${account}:table/NotificationOutbox/index/*`,
  ];
  await iam.send(new PutRolePolicyCommand({
    RoleName: workerRoleName, PolicyName: 'BusTrackerWorkerLeastPrivilege',
    PolicyDocument: JSON.stringify({ Version: '2012-10-17', Statement: [
      { Effect: 'Allow', Action: ['dynamodb:PutItem'], Resource: alertsTableArn },
      { Effect: 'Allow', Action: ['dynamodb:UpdateItem', 'dynamodb:Query'], Resource: outboxTableArns },
      { Effect: 'Allow', Action: ['sqs:GetQueueUrl', 'sqs:SendMessage', 'sqs:ReceiveMessage', 'sqs:DeleteMessage'], Resource: [`arn:aws:sqs:${region}:${account}:${queueName}`] },
      { Effect: 'Allow', Action: ['logs:CreateLogStream', 'logs:PutLogEvents'], Resource: [`arn:aws:logs:${region}:${account}:log-group:${logGroup}:*`] },
    ] }),
  }));
  await iam.send(new PutRolePolicyCommand({
    RoleName: executionRoleName, PolicyName: 'BusTrackerEcsExecutionLeastPrivilege',
    PolicyDocument: JSON.stringify({ Version: '2012-10-17', Statement: [
      { Effect: 'Allow', Action: ['ecr:GetAuthorizationToken'], Resource: '*' },
      { Effect: 'Allow', Action: ['ecr:BatchCheckLayerAvailability', 'ecr:GetDownloadUrlForLayer', 'ecr:BatchGetImage'], Resource: [`arn:aws:ecr:${region}:${account}:repository/${config.ecrRepository || process.env.ECR_REPOSITORY || 'school-bus-tracker-backend'}`] },
      { Effect: 'Allow', Action: ['logs:CreateLogStream', 'logs:PutLogEvents'], Resource: [`arn:aws:logs:${region}:${account}:log-group:${logGroup}:*`] },
    ] }),
  }));
  return { roles: [apiRole, workerRole, executionRole].map(({ RoleName, Arn }) => ({ name: RoleName, arn: Arn })) };
}

module.exports = { provision, ensureRole, policyDocument };
