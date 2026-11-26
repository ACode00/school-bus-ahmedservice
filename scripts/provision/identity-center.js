const {
  CreateAccountAssignmentCommand,
  CreatePermissionSetCommand,
  DescribeAccountAssignmentCreationStatusCommand,
  ListAccountAssignmentsCommand,
  ListPermissionSetsCommand,
  PutInlinePolicyToPermissionSetCommand,
} = require('@aws-sdk/client-sso-admin');
const { CreateGroupCommand, ListGroupsCommand } = require('@aws-sdk/client-identitystore');
const { GetRestApisCommand } = require('@aws-sdk/client-api-gateway');
const { ROLE_ROUTE_PATTERNS } = require('../../config/api-route-permissions');

const ROLE_DESCRIPTIONS = Object.freeze({
  BusTrackerParents: 'School Bus Tracker parent access',
  BusTrackerCoordinators: 'School Bus Tracker bus coordinator (supervisor) access',
  BusTrackerAdmins: 'School Bus Tracker administrator access',
});
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function ensureGroup(identityStore, identityStoreId, displayName) {
  const listed = await identityStore.send(new ListGroupsCommand({
    IdentityStoreId: identityStoreId,
    Filters: [{ AttributePath: 'DisplayName', AttributeValue: displayName }],
  }));
  const existing = (listed.Groups || []).find((group) => group.DisplayName === displayName);
  if (existing) return existing;
  return identityStore.send(new CreateGroupCommand({
    IdentityStoreId: identityStoreId,
    DisplayName: displayName,
    Description: ROLE_DESCRIPTIONS[displayName],
  }));
}

async function resolveApiId(apiGateway, config) {
  if (config.apiGatewayId) return config.apiGatewayId;
  const result = await apiGateway.send(new GetRestApisCommand({ limit: 500 }));
  const matches = (result.items || []).filter((api) => api.name === (config.apiGatewayName || 'school-bus-tracker-api'));
  if (matches.length !== 1) throw new Error(`Expected one API Gateway REST API named ${config.apiGatewayName || 'school-bus-tracker-api'}; found ${matches.length}`);
  return matches[0].id;
}

function permissionPolicy({ roleName, apiId, region, accountId, stage }) {
  const resources = ROLE_ROUTE_PATTERNS[roleName].map((pattern) => {
    const slash = pattern.indexOf('/');
    const method = pattern.slice(0, slash);
    const path = pattern.slice(slash + 1);
    return `arn:aws:execute-api:${region}:${accountId}:${apiId}/${stage}/${method}/${path}`;
  });
  return JSON.stringify({ Version: '2012-10-17', Statement: [{ Effect: 'Allow', Action: 'execute-api:Invoke', Resource: resources }] });
}

async function ensurePermissionSet(ssoAdmin, { instanceArn, roleName, roleGroup, apiId, config, region, accountId }) {
  const listed = await ssoAdmin.send(new ListPermissionSetsCommand({ InstanceArn: instanceArn, MaxResults: 100 }));
  let permissionSetArn;
  for (const arn of listed.PermissionSets || []) {
    const result = await ssoAdmin.send(new (require('@aws-sdk/client-sso-admin').DescribePermissionSetCommand)({ InstanceArn: instanceArn, PermissionSetArn: arn }));
    if (result.PermissionSet?.Name === roleName) { permissionSetArn = arn; break; }
  }
  if (!permissionSetArn) {
    const created = await ssoAdmin.send(new CreatePermissionSetCommand({
      InstanceArn: instanceArn,
      Name: roleName,
      Description: ROLE_DESCRIPTIONS[roleName],
      SessionDuration: 'PT1H',
    }));
    permissionSetArn = created.PermissionSet?.PermissionSetArn;
  }
  if (!permissionSetArn) throw new Error(`Identity Center did not return a permission set ARN for ${roleName}`);
  await ssoAdmin.send(new PutInlinePolicyToPermissionSetCommand({
    InstanceArn: instanceArn,
    PermissionSetArn: permissionSetArn,
    InlinePolicy: permissionPolicy({ roleName, apiId, region, accountId, stage: config.apiGatewayStage || 'local' }),
  }));
  await ensureAssignment(ssoAdmin, {
    instanceArn, permissionSetArn, accountId,
    principalId: roleGroup.GroupId,
    pollAttempts: config.accountAssignmentPollAttempts || 40,
    pollDelayMs: config.accountAssignmentPollDelayMs ?? 250,
  });
  return permissionSetArn;
}

async function ensureAssignment(ssoAdmin, { instanceArn, permissionSetArn, accountId, principalId, pollAttempts, pollDelayMs }) {
  const existing = await ssoAdmin.send(new ListAccountAssignmentsCommand({
    InstanceArn: instanceArn, AccountId: accountId, PermissionSetArn: permissionSetArn, MaxResults: 100,
  }));
  if ((existing.AccountAssignments || []).some((assignment) => assignment.PrincipalId === principalId && assignment.PrincipalType === 'GROUP')) return;
  const response = await ssoAdmin.send(new CreateAccountAssignmentCommand({
    InstanceArn: instanceArn, TargetId: accountId, TargetType: 'AWS_ACCOUNT',
    PermissionSetArn: permissionSetArn, PrincipalType: 'GROUP', PrincipalId: principalId,
  }));
  const immediateStatus = response.AccountAssignmentCreationStatus?.Status;
  if (immediateStatus === 'SUCCEEDED') return;
  if (['FAILED', 'CANCELLED'].includes(immediateStatus)) throw new Error(`Identity Center assignment failed: ${response.AccountAssignmentCreationStatus?.FailureReason || immediateStatus}`);
  const requestId = response.AccountAssignmentCreationStatus?.RequestId;
  if (!requestId) throw new Error(`Identity Center did not return an account-assignment request for ${permissionSetArn}`);
  for (let attempt = 0; attempt < pollAttempts; attempt += 1) {
    const result = await ssoAdmin.send(new DescribeAccountAssignmentCreationStatusCommand({ InstanceArn: instanceArn, AccountId: accountId, PermissionSetArn: permissionSetArn, RequestId: requestId }));
    const status = result.AccountAssignmentCreationStatus;
    if (status?.Status === 'SUCCEEDED') return;
    if (['FAILED', 'CANCELLED'].includes(status?.Status)) throw new Error(`Identity Center assignment failed: ${status.FailureReason || status.Status}`);
    if (attempt + 1 < pollAttempts) await delay(pollDelayMs);
  }
  throw new Error(`Timed out waiting for Identity Center account assignment ${requestId}`);
}

async function provision({ ssoAdmin, identityStore, apiGateway }, config = {}) {
  const instanceArn = config.ssoInstanceArn || process.env.SSO_INSTANCE_ARN;
  const identityStoreId = config.ssoIdentityStoreId || process.env.SSO_IDENTITY_STORE_ID;
  if (!instanceArn || !identityStoreId) throw new Error('SSO_INSTANCE_ARN and SSO_IDENTITY_STORE_ID are required');
  if (!apiGateway) throw new Error('API Gateway client is required to scope Identity Center policies');
  const region = config.ssoRegion || config.awsRegion || process.env.SSO_REGION || process.env.AWS_REGION || 'us-east-1';
  const accountId = config.ssoAccountId || config.accountId || process.env.SSO_ACCOUNT_ID || process.env.FLOCI_ACCOUNT_ID || '000000000000';
  const apiId = await resolveApiId(apiGateway, config);
  const groups = {};
  const permissionSets = {};
  for (const roleName of Object.keys(ROLE_DESCRIPTIONS)) {
    const group = await ensureGroup(identityStore, identityStoreId, roleName);
    if (!group?.GroupId) throw new Error(`Identity Center did not return a group ID for ${roleName}`);
    groups[roleName] = { id: group.GroupId, displayName: roleName };
    permissionSets[roleName] = await ensurePermissionSet(ssoAdmin, {
      instanceArn, roleName, roleGroup: group, apiId, config, region, accountId,
    });
  }
  return { instanceArn, identityStoreId, apiId, groups, permissionSets };
}

module.exports = { provision, ensureGroup, ensureAssignment, permissionPolicy, resolveApiId };
