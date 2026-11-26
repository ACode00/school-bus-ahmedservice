const { loadConfig } = require('../config/env');
const { createAwsClients } = require('../config/aws-clients');

const serviceModules = {
  dynamodb: './provision/dynamodb',
  sqs: './provision/sqs',
  cloudwatch: './provision/cloudwatch',
  iam: './provision/iam',
  ecs: './provision/ecs',
  cache: './provision/cache',
  identityCenter: './provision/identity-center',
  apiGateway: './provision/api-gateway',
};

async function main(serviceName) {
  const modulePath = serviceModules[serviceName];
  if (!modulePath) {
    throw new Error(`Unknown service '${serviceName}'. Choose: ${Object.keys(serviceModules).join(', ')}`);
  }
  const handler = require(modulePath);
  const config = loadConfig(process.env);
  const clients = createAwsClients(config);
  const result = await handler.provision(clients, config);
  process.stdout.write(`${JSON.stringify({ service: serviceName, result }, null, 2)}\n`);
}

if (require.main === module) {
  main(process.argv[2]).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = { main, serviceModules };
