#!/bin/sh
set -eu
node scripts/provision.js dynamodb
node scripts/provision.js sqs
node scripts/provision.js cloudwatch
node scripts/provision.js iam
node scripts/provision.js cache
node scripts/provision.js apiGateway
node scripts/provision.js ecs
if [ "${SEED_SAMPLE_DATA:-false}" = "true" ]; then node scripts/seed.js; fi
exec node index.js
