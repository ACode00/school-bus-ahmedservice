const {
  CreatePermissionSetCommand, CreateAccountAssignmentCommand,
  PutInlinePolicyToPermissionSetCommand,
} = require('@aws-sdk/client-sso-admin');
const { CreateGroupCommand } = require('@aws-sdk/client-identitystore');
const { provision } = require('../../scripts/provision/identity-center');

test('creates role groups and route-scoped Identity Center permission sets without user credentials', async () => {
  const identityStore = { send: jest.fn(async (command) => {
    if (command instanceof CreateGroupCommand) return { GroupId: `group-${command.input.DisplayName}` };
    return { Groups: [] };
  }) };
  const ssoAdmin = { send: jest.fn(async (command) => {
    if (command instanceof CreatePermissionSetCommand) return { PermissionSet: { PermissionSetArn: `arn:aws:sso:::permissionSet/test/${command.input.Name}` } };
    if (command instanceof CreateAccountAssignmentCommand) return { AccountAssignmentCreationStatus: { RequestId: 'request-1' } };
    if (command.input?.RequestId) return { AccountAssignmentCreationStatus: { Status: 'SUCCEEDED' } };
    return { PermissionSets: [] };
  }) };
  const apiGateway = { send: jest.fn().mockResolvedValue({ items: [{ id: 'gateway-123', name: 'school-bus-tracker-api' }] }) };

  const result = await provision({ identityStore, ssoAdmin, apiGateway }, {
    ssoInstanceArn: 'arn:aws:sso:::instance/ssoins-test', ssoIdentityStoreId: 'd-test',
    ssoAccountId: '000000000000', ssoRegion: 'us-east-1', apiGatewayStage: 'local', apiGatewayName: 'school-bus-tracker-api',
    accountAssignmentPollAttempts: 1, accountAssignmentPollDelayMs: 0,
  });

  expect(identityStore.send.mock.calls.filter(([cmd]) => cmd instanceof CreateGroupCommand)).toHaveLength(3);
  expect(ssoAdmin.send.mock.calls.filter(([cmd]) => cmd instanceof CreatePermissionSetCommand)).toHaveLength(3);
  const policies = ssoAdmin.send.mock.calls.filter(([cmd]) => cmd instanceof PutInlinePolicyToPermissionSetCommand);
  expect(policies).toHaveLength(3);
  const parentPolicy = JSON.parse(policies.find(([cmd]) => cmd.input.PermissionSetArn.endsWith('/BusTrackerParents'))[0].input.InlinePolicy);
  expect(parentPolicy.Statement[0].Action).toBe('execute-api:Invoke');
  expect(parentPolicy.Statement[0].Resource).toContain('arn:aws:execute-api:us-east-1:000000000000:gateway-123/local/GET/api/trips/*/eta');
  expect(ssoAdmin.send.mock.calls.filter(([cmd]) => cmd instanceof CreateAccountAssignmentCommand)).toHaveLength(3);
  expect(result.groups).toHaveProperty('BusTrackerParents');
});

test('fails clearly when Identity Center instance settings are missing', async () => {
  await expect(provision({}, {})).rejects.toThrow('SSO_INSTANCE_ARN and SSO_IDENTITY_STORE_ID are required');
});
