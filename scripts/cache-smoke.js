const { CacheService } = require('../services/cache.service');
const { createRedisClient } = require('../services/redis-client');
const { loadConfig } = require('../config/env');
const { createLogger } = require('../config/logger');
const crypto = require('node:crypto');

async function main() {
  const config = loadConfig(process.env);
  const logger = createLogger();
  const client = createRedisClient(config, logger);
  await client.connect();
  const cache = new CacheService({ client, defaultTtlMs: 1000, logger });
  const key = `cache-smoke:${crypto.randomUUID()}`;
  const loader = async () => ({ ok: true });
  try {
    const first = await cache.getOrLoad(key, loader);
    const second = await cache.getOrLoad(key, loader);
    if (first.cacheStatus !== 'MISS' || second.cacheStatus !== 'HIT') {
      throw new Error('ElastiCache smoke check failed');
    }
    await cache.invalidate(key);
    process.stdout.write('ElastiCache smoke check passed (MISS then HIT).\n');
  } finally {
    if (client.isOpen) await client.quit();
  }
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
