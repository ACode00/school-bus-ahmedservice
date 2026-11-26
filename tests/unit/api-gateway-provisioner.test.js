const {
  CreateDeploymentCommand, CreateResourceCommand, CreateRestApiCommand, GetResourcesCommand,
  PutIntegrationCommand, PutMethodCommand,
} = require('@aws-sdk/client-api-gateway');
const { API_METHODS, ROLE_ROUTE_PATTERNS } = require('../../config/api-route-permissions');
const { permissionPolicy } = require('../../scripts/provision/identity-center');
const { provision } = require('../../scripts/provision/api-gateway');

test('configures open API Gateway forwarding and leaves app authentication to bearer sessions', async () => {
  const paths = new Map([['/', { id: 'root', path: '/' }]]);
  const apiGateway = { send: jest.fn(async (command) => {
    if (command instanceof CreateRestApiCommand) return { id: 'api-1' };
    if (command instanceof GetResourcesCommand) return { items: [...paths.values()] };
    if (command instanceof CreateResourceCommand) {
      const parent = [...paths.values()].find((item) => item.id === command.input.parentId);
      const item = { id: `res-${paths.size}`, path: `${parent.path.replace(/\/$/, '')}/${command.input.pathPart}` };
      paths.set(item.path, item); return item;
    }
    return {};
  }) };
  const result = await provision({ apiGateway }, { apiBackendUrl: 'http://backend:3000', flociEndpoint: 'http://floci:4566', apiGatewayName: 'school-bus-tracker-api', apiGatewayStage: 'local', awsRegion: 'us-east-1' });
  const methods = apiGateway.send.mock.calls.map(([command]) => command).filter((command) => command instanceof PutMethodCommand);
  const integrations = apiGateway.send.mock.calls.map(([command]) => command).filter((command) => command instanceof PutIntegrationCommand);
  expect(methods).toHaveLength(API_METHODS.length);
  expect(methods.find((command) => command.input.resourceId === paths.get('/health').id).input.authorizationType).toBe('NONE');
  expect(methods.every((command) => command.input.authorizationType === 'NONE')).toBe(true);
  expect(integrations.every((command) => !command.input.requestParameters?.['integration.request.header.X-IAM-User-Arn'])).toBe(true);
  expect(integrations.every((command) => command.input.type === 'HTTP_PROXY')).toBe(true);
  expect(apiGateway.send.mock.calls.some(([command]) => command instanceof CreateDeploymentCommand)).toBe(true);
  expect(result).toMatchObject({ apiId: 'api-1', stage: 'local', invokeUrl: 'http://floci:4566/restapis/api-1/local/_user_request_' });
});

test('Identity Center policies follow the same route matrix and health remains public', () => {
  const policy = JSON.parse(permissionPolicy({ roleName: 'BusTrackerParents', apiId: 'api-1', region: 'us-east-1', accountId: '000000000000', stage: 'local' }));
  expect(policy.Statement[0].Resource).toEqual(ROLE_ROUTE_PATTERNS.BusTrackerParents.map((pattern) => {
    const split = pattern.indexOf('/');
    return `arn:aws:execute-api:us-east-1:000000000000:api-1/local/${pattern.slice(0, split)}/${pattern.slice(split + 1)}`;
  }));
  expect(API_METHODS.find((route) => route.path === '/health')).toMatchObject({ method: 'GET', public: true });
});

test('requires a reachable backend integration URL before provisioning', async () => {
  await expect(provision({ apiGateway: { send: jest.fn() } }, {})).rejects.toThrow('API_BACKEND_URL is required');
});
