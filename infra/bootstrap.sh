#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"
if [[ -f .env ]]; then set -a; source .env; set +a; fi
for service_script in dynamodb.sh sqs.sh cloudwatch-logs.sh iam.sh cache.sh api-gateway.sh; do
  echo "==> ${service_script}"
  bash "infra/$service_script"
done
echo "==> ecs.sh"
bash infra/ecs.sh
