const { CreateRoleCommand, PutRolePolicyCommand } = require('@aws-sdk/client-iam');
const { CreateClusterCommand, RegisterTaskDefinitionCommand, CreateServiceCommand, DescribeServicesCommand, UpdateServiceCommand } = require('@aws-sdk/client-ecs');
const iam = require('../../scripts/provision/iam');
const ecs = require('../../scripts/provision/ecs');
const fs = require('node:fs');
const path = require('node:path');

test('IAM provisioning separates API, worker, and execution permissions', async () => {
  const client = { send: jest.fn().mockImplementation((command) => {
    if (command instanceof CreateRoleCommand) return Promise.resolve({ Role: { RoleName: command.input.RoleName, Arn: `arn:aws:iam::000000000000:role/${command.input.RoleName}` } });
    return Promise.resolve({});
  }) };
  const result = await iam.provision({ iam: client }, { awsRegion: 'us-east-1', accountId: '000000000000', ssoIdentityStoreId: 'd-store-1' });
  expect(result.roles.map((role) => role.name)).toEqual(expect.arrayContaining([
    'BusTrackerApiTaskRole', 'BusTrackerWorkerTaskRole', 'BusTrackerEcsExecutionRole',
  ]));
  const policies = Object.fromEntries(client.send.mock.calls
    .filter(([cmd]) => cmd instanceof PutRolePolicyCommand)
    .map(([cmd]) => [cmd.input.RoleName, JSON.parse(cmd.input.PolicyDocument)]));
  const apiSqs = policies.BusTrackerApiTaskRole.Statement.find((item) => item.Action.some((action) => action.startsWith('sqs:')));
  const workerSqs = policies.BusTrackerWorkerTaskRole.Statement.find((item) => item.Action.some((action) => action.startsWith('sqs:')));
  expect(apiSqs.Action).toEqual(['sqs:GetQueueUrl', 'sqs:SendMessage']);
  expect(policies.BusTrackerApiTaskRole.Statement.find((item) => item.Action.includes('identitystore:DescribeUser'))).toMatchObject({ Resource: ['arn:aws:identitystore::000000000000:identitystore/d-store-1'] });
  expect(workerSqs.Action).toEqual(['sqs:GetQueueUrl', 'sqs:SendMessage', 'sqs:ReceiveMessage', 'sqs:DeleteMessage']);
  const alertPolicy = policies.BusTrackerWorkerTaskRole.Statement.find((item) => item.Resource.includes('arn:aws:dynamodb:us-east-1:000000000000:table/Alerts'));
  const outboxPolicy = policies.BusTrackerWorkerTaskRole.Statement.find((item) => item.Resource.includes('arn:aws:dynamodb:us-east-1:000000000000:table/NotificationOutbox'));
  expect(alertPolicy.Action).toEqual(['dynamodb:PutItem']);
  expect(outboxPolicy.Action).toEqual(['dynamodb:UpdateItem', 'dynamodb:Query']);
  expect(outboxPolicy.Resource).not.toContain('arn:aws:dynamodb:us-east-1:000000000000:table/Alerts');
  const roles = client.send.mock.calls.filter(([cmd]) => cmd instanceof CreateRoleCommand);
  expect(roles[0][0].input.AssumeRolePolicyDocument).toContain('ecs-tasks.amazonaws.com');
});

test('ECS provisioning registers separate API and worker tasks with different IAM roles', async () => {
  const client = { send: jest.fn().mockImplementation((command) => {
    if (command instanceof CreateClusterCommand) return Promise.resolve({ cluster: { clusterArn: 'cluster-arn' } });
    if (command instanceof RegisterTaskDefinitionCommand) return Promise.resolve({ taskDefinition: { taskDefinitionArn: `${command.input.family}-arn` } });
    if (command instanceof CreateServiceCommand) return Promise.resolve({ service: { serviceArn: `${command.input.serviceName}-arn` } });
    if (command instanceof DescribeServicesCommand) return Promise.resolve({ services: [] });
    if (command instanceof UpdateServiceCommand) return Promise.resolve({ service: { serviceArn: 'service-arn' } });
    return Promise.resolve({});
  }) };
  const result = await ecs.provision({ ecs: client }, { awsRegion: 'us-east-1', flociEndpoint: 'http://floci:4566' });
  expect(result.apiTaskDefinitionArn).toBe('school-bus-tracker-api-arn');
  expect(result.workerTaskDefinitionArn).toBe('school-bus-tracker-api-worker-arn');
  expect(client.send.mock.calls.some(([cmd]) => cmd instanceof CreateClusterCommand)).toBe(true);
  const tasks = client.send.mock.calls.filter(([cmd]) => cmd instanceof RegisterTaskDefinitionCommand).map(([cmd]) => cmd.input);
  expect(tasks).toHaveLength(2);
  expect(tasks[0].taskRoleArn).toContain('BusTrackerApiTaskRole');
  expect(tasks[0].containerDefinitions).toHaveLength(1);
  expect(tasks[0].containerDefinitions[0].healthCheck.command.join(' ')).toContain('fetch');
  expect(tasks[0].containerDefinitions[0].logConfiguration.logDriver).toBe('awslogs');
  expect(tasks[0].containerDefinitions[0].environment).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'FLOCI_ENDPOINT', value: 'http://floci:4566' })]));
  expect(tasks[1].taskRoleArn).toContain('BusTrackerWorkerTaskRole');
  expect(tasks[1].containerDefinitions).toHaveLength(1);
  expect(tasks[1].containerDefinitions[0].command).toEqual(['node', 'worker.js']);
  expect(client.send.mock.calls.filter(([cmd]) => cmd instanceof CreateServiceCommand)).toHaveLength(2);
});

test('container setup runs backend beside persistent Floci and wires health checks', () => {
  const root = path.resolve(__dirname, '../..');
  const compose = fs.readFileSync(path.join(root, 'docker-compose.yml'), 'utf8');
  const dockerfile = fs.readFileSync(path.join(root, 'Dockerfile'), 'utf8');
  expect(compose).toContain('floci-data:/app/data');
  expect(compose).toContain('condition: service_healthy');
  expect(compose).toContain('http://floci:4566');
  expect(compose).toContain('school-bus-tracker-api');
  expect(compose).toContain('school-bus-tracker-worker');
  expect(compose).toContain('API_GATEWAY_AUTH_REQUIRED');
  expect(compose).not.toMatch(/ports:\s*\n\s*-\s*['"]?3000:3000/);
  expect(compose).toContain('API_BACKEND_URL: http://backend:3000');
  expect(compose).toContain('ECS_DESIRED_COUNT: "0"');
  expect(compose).toContain('worker.js');
  expect(dockerfile).toContain('HEALTHCHECK');
  expect(dockerfile).toContain('USER node');
});
