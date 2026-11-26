#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"
if [[ -f .env ]]; then set -a; source .env; set +a; fi
for service_script in dynamodb.sh sqs.sh cloudwatch-logs.sh iam.sh cache.sh api-gateway.sh; do
  echo "==> ${service_script}"
  bash "infra/$service_script"
done
if [[ -n "${SSO_INSTANCE_ARN:-}" && -n "${SSO_IDENTITY_STORE_ID:-}" ]]; then
  echo "==> identity-center.sh"
  bash infra/identity-center.sh
else
  echo "Skipping Identity Center assignments: set SSO_INSTANCE_ARN and SSO_IDENTITY_STORE_ID in .env"
fi
echo "==> ecs.sh"
bash infra/ecs.sh
