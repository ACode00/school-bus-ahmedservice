#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"
command -v node >/dev/null || { echo "node is required" >&2; exit 1; }
FLOCI_ENDPOINT="${FLOCI_ENDPOINT:-${AWS_ENDPOINT_URL:-http://localhost:4566}}"
export FLOCI_ENDPOINT AWS_ENDPOINT_URL="$FLOCI_ENDPOINT"
export AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test AWS_REGION="${AWS_REGION:-us-east-1}"
node - "$FLOCI_ENDPOINT" <<'NODE'
const url = new URL(process.argv[2]);
if (!['http:', 'https:'].includes(url.protocol) || !['localhost', '127.0.0.1', '::1', 'floci'].includes(url.hostname.toLowerCase())) {
  console.error(`Refusing non-local AWS endpoint: ${url.hostname}`);
  process.exit(1);
}
NODE
node scripts/provision.js ecs
