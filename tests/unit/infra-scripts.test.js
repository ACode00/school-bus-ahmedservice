const fs = require('node:fs');
const path = require('node:path');

const infraDir = path.resolve(__dirname, '../../infra');

describe('standalone infrastructure shell entrypoints', () => {
  test.each([
    ['dynamodb', 'dynamodb'],
    ['sqs', 'sqs'],
    ['cloudwatch-logs', 'cloudwatch'],
    ['iam', 'iam'],
    ['ecs', 'ecs'],
    ['api-gateway', 'apiGateway'],
  ])('%s runs only its own provisioner selector', (file, selector) => {
    const script = fs.readFileSync(path.join(infraDir, `${file}.sh`), 'utf8');
    expect(script).toMatch(new RegExp(`node scripts/provision\\.js ${selector}`));
    expect(script).toContain('cd "$ROOT_DIR"');
    expect(script).toContain('FLOCI_ENDPOINT');
    expect(script).toContain('AWS_ENDPOINT_URL');
    expect(script).toContain('Refusing non-local AWS endpoint');
  });

  test('cache check is standalone and bootstrap calls each service initializer in dependency order', () => {
    const cacheScript = fs.readFileSync(path.join(infraDir, 'cache.sh'), 'utf8');
    const bootstrap = fs.readFileSync(path.join(infraDir, 'bootstrap.sh'), 'utf8');
    expect(cacheScript).toContain('node scripts/provision.js cache');
    expect(cacheScript).toContain('node scripts/cache-smoke.js');
    expect(cacheScript).toContain('cd "$ROOT_DIR"');
    for (const script of ['dynamodb.sh', 'sqs.sh', 'cloudwatch-logs.sh', 'iam.sh', 'cache.sh', 'api-gateway.sh', 'ecs.sh']) {
      expect(bootstrap).toContain(script);
    }
  });
});
