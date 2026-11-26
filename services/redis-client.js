const { createClient } = require('redis');

function createRedisClient(config = {}, logger = null, redisFactory = createClient) {
  const url = config.cacheUrl || `redis://${config.cacheHost || 'localhost'}:${config.cachePort || 6379}`;
  const maxRetries = config.cacheConnectRetries ?? 5;
  const parsedUrl = new URL(url);
  const client = redisFactory({
    url,
    socket: {
      reconnectStrategy: (retries) => retries >= maxRetries
        ? new Error(`ElastiCache Redis connection failed after ${retries} retries`)
        : Math.min(retries * 250, 3000),
    },
  });
  client.on('error', (error) => {
    const cause = error.cause;
    logger?.error({
      event: 'elasticache_connection_error',
      message: error.message || cause?.message || error.code || cause?.code || String(error),
      error_name: error.name,
      error_code: error.code || cause?.code,
      syscall: error.syscall || cause?.syscall,
      address: error.address || cause?.address,
      port: error.port || cause?.port,
      host: parsedUrl.hostname,
      target_port: parsedUrl.port ? Number(parsedUrl.port) : (parsedUrl.protocol === 'rediss:' ? 6380 : 6379),
    });
  });
  return client;
}

module.exports = { createRedisClient };
