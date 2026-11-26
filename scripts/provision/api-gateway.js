const {
  CreateDeploymentCommand, CreateResourceCommand, CreateRestApiCommand, GetDeploymentsCommand,
  GetMethodCommand, GetResourcesCommand, GetRestApisCommand,
  PutIntegrationCommand, PutMethodCommand, UpdateMethodCommand,
} = require('@aws-sdk/client-api-gateway');
const { API_METHODS } = require('../../config/api-route-permissions');

async function ensureApi(client, config) {
  if (config.apiGatewayId) return config.apiGatewayId;
  const listed = await client.send(new GetRestApisCommand({ limit: 500 }));
  const existing = (listed.items || []).find((api) => api.name === config.apiGatewayName);
  if (existing) return existing.id;
  const created = await client.send(new CreateRestApiCommand({ name: config.apiGatewayName, description: 'School Bus Route Tracker API', endpointConfiguration: { types: ['REGIONAL'] } }));
  if (!created.id) throw new Error('API Gateway did not return an API ID');
  return created.id;
}

async function ensureResource(client, apiId, path) {
  let resources = (await client.send(new GetResourcesCommand({ restApiId: apiId, limit: 500 }))).items || [];
  const root = resources.find((item) => item.path === '/');
  if (!root) throw new Error('API Gateway root resource is missing');
  let parentId = root.id;
  let currentPath = '';
  for (const part of path.split('/').filter(Boolean)) {
    currentPath += `/${part}`;
    let resource = resources.find((item) => item.path === currentPath);
    if (!resource) {
      resource = await client.send(new CreateResourceCommand({ restApiId: apiId, parentId, pathPart: part }));
      resources = [...resources, resource];
    }
    parentId = resource.id;
  }
  return parentId;
}

function isMissing(error) { return error?.name === 'NotFoundException'; }
function diffMap(current, desired, prefix) {
  const operations = [];
  for (const [key, value] of Object.entries(desired)) operations.push({ op: Object.hasOwn(current, key) ? 'replace' : 'add', path: `${prefix}/${key.replaceAll('~', '~0').replaceAll('/', '~1')}`, value: String(value) });
  for (const key of Object.keys(current)) if (!Object.hasOwn(desired, key)) operations.push({ op: 'remove', path: `${prefix}/${key.replaceAll('~', '~0').replaceAll('/', '~1')}` });
  return operations;
}

async function ensureMethod(client, input) {
  let existing;
  try { existing = await client.send(new GetMethodCommand(input)); }
  catch (error) { if (!isMissing(error)) throw error; }
  if (!existing?.authorizationType) return client.send(new PutMethodCommand(input));
  const patchOperations = [{ op: 'replace', path: '/authorizationType', value: input.authorizationType }, ...diffMap(existing.requestParameters || {}, input.requestParameters || {}, '/requestParameters')];
  if (patchOperations.length) await client.send(new UpdateMethodCommand({ ...input, patchOperations }));
  return existing;
}

async function ensureIntegration(client, input) {
  return client.send(new PutIntegrationCommand(input));
}

async function ensureDeployment(client, { apiId, stage, backendUrl }) {
  const hash = crypto.createHash('sha256').update(`${backendUrl}:${JSON.stringify(API_METHODS)}`).digest('hex').slice(0, 20);
  const fingerprint = `bus-tracker:${stage}:${hash}`;
  const listed = await client.send(new GetDeploymentsCommand({ restApiId: apiId, limit: 500 }));
  const deployment = (listed.items || []).find((item) => item.description === fingerprint);
  if (deployment) return deployment;
  return client.send(new CreateDeploymentCommand({ restApiId: apiId, stageName: stage, description: fingerprint }));
}

async function provision({ apiGateway }, config = {}) {
  if (!config.apiBackendUrl) throw new Error('API_BACKEND_URL is required for the private HTTP proxy integration');
  const backend = new URL(config.apiBackendUrl);
  if (!['http:', 'https:'].includes(backend.protocol) || !backend.hostname) throw new Error('API_BACKEND_URL must be an HTTP(S) URL reachable from API Gateway');
  if (!apiGateway) throw new Error('API Gateway client is required');
  const apiId = await ensureApi(apiGateway, { ...config, apiGatewayName: config.apiGatewayName || 'school-bus-tracker-api' });
  const existing = (await apiGateway.send(new GetResourcesCommand({ restApiId: apiId, limit: 500 }))).items || [];
  if (!existing.length) throw new Error('API Gateway did not return its root resource');
  for (const route of API_METHODS) {
    const resourceId = await ensureResource(apiGateway, apiId, route.path);
    const parameters = [...route.path.matchAll(/\{([^}]+)\}/g)].map((match) => `method.request.path.${match[1]}`);
    const method = route.method;
    await ensureMethod(apiGateway, {
      restApiId: apiId, resourceId, httpMethod: method,
      authorizationType: 'NONE',
      requestParameters: Object.fromEntries(parameters.map((key) => [key, true])),
    });
    const backendPath = route.path.replace(/\{([^}]+)\}/g, '{$1}');
    const uri = `${backend.origin}${backend.pathname.replace(/\/$/, '')}${backendPath}`;
    const requestParameters = {};
    for (const match of route.path.matchAll(/\{([^}]+)\}/g)) requestParameters[`integration.request.path.${match[1]}`] = `method.request.path.${match[1]}`;
    await ensureIntegration(apiGateway, {
      restApiId: apiId, resourceId, httpMethod: method,
      type: 'HTTP_PROXY', integrationHttpMethod: method, uri,
      requestParameters,
    });
  }
  const stage = config.apiGatewayStage || 'local';
  await ensureDeployment(apiGateway, { apiId, stage, backendUrl: config.apiBackendUrl });
  const endpoint = (config.apiGatewayInvokeEndpoint || config.flociEndpoint || process.env.FLOCI_ENDPOINT || process.env.AWS_ENDPOINT_URL || 'http://localhost:4566').replace(/\/$/, '');
  return { apiId, stage, invokeUrl: `${endpoint}/restapis/${apiId}/${stage}/_user_request_` };
}

module.exports = { provision, ensureApi, ensureResource, ensureMethod, ensureIntegration, ensureDeployment };
const crypto = require('node:crypto');
