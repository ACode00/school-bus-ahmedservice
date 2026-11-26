const { loadConfig, parseOrigins } = require('../../config/env');

describe('environment configuration', () => {
  test('uses Floci-safe defaults', () => {
    const config = loadConfig({});

    expect(config.port).toBe(3000);
    expect(config.flociEndpoint).toBe('http://localhost:4566');
    expect(config.awsAccessKeyId).toBe('test');
    expect(config.awsSecretAccessKey).toBe('test');
  });

  test('parses configured CORS origins without whitespace or empty entries', () => {
    expect(parseOrigins('https://one.example, , https://two.example ')).toEqual([
      'https://one.example',
      'https://two.example',
    ]);
  });

  test('rejects invalid API ports', () => {
    expect(() => loadConfig({ PORT: '70000' })).toThrow('PORT must be an integer');
  });

  test('loads IAM Identity Center and API Gateway settings', () => {
    expect(loadConfig({
      SSO_INSTANCE_ARN: 'arn:aws:sso:::instance/ssoins-test',
      SSO_IDENTITY_STORE_ID: 'd-test',
      API_GATEWAY_ID: 'api-test',
      API_GATEWAY_STAGE: 'local',
      API_BACKEND_URL: 'http://backend:3000',
    })).toMatchObject({
      ssoInstanceArn: 'arn:aws:sso:::instance/ssoins-test',
      ssoIdentityStoreId: 'd-test',
      apiGatewayId: 'api-test',
      apiGatewayStage: 'local',
      apiBackendUrl: 'http://backend:3000',
      apiGatewayInvokeEndpoint: 'http://localhost:4566',
    });
  });

  test('uses the AWS SDK credential provider chain instead of Floci credentials in production', () => {
    expect(loadConfig({ NODE_ENV: 'production' }).flociEndpoint).toBe('');
    const clients = require('../../config/aws-clients').createAwsClients({ nodeEnv: 'production', flociEndpoint: '' });
    expect(clients.endpoint).toBeUndefined();
  });
});
