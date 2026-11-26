#!/bin/sh
set -eu
node scripts/provision.js dynamodb
node scripts/provision.js sqs
node scripts/provision.js cloudwatch
node scripts/provision.js iam
node scripts/provision.js cache
node scripts/provision.js apiGateway
if [ -n "${SSO_INSTANCE_ARN:-}" ] && [ -n "${SSO_IDENTITY_STORE_ID:-}" ]; then
  node scripts/provision.js identityCenter
fi
node scripts/provision.js ecs
if [ "${SEED_SAMPLE_DATA:-false}" = "true" ]; then node scripts/seed.js; fi
exec node index.js
