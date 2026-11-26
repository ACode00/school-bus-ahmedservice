const {
  CreateCacheClusterCommand,
  DescribeCacheClustersCommand,
} = require('@aws-sdk/client-elasticache');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function describe(elasticache, cacheClusterId) {
  try {
    const result = await elasticache.send(new DescribeCacheClustersCommand({ CacheClusterId: cacheClusterId, ShowCacheNodeInfo: true }));
    return result.CacheClusters?.[0] || null;
  } catch (error) {
    if (['CacheClusterNotFound', 'CacheClusterNotFoundFault'].includes(error.name)) return null;
    throw error;
  }
}

async function provision({ elasticache }, config = {}) {
  const cacheClusterId = config.cacheClusterId || process.env.CACHE_CLUSTER_ID || 'school-bus-tracker-cache';
  const port = config.cachePort || Number.parseInt(process.env.CACHE_PORT || '6379', 10);
  const host = config.cacheHost || process.env.CACHE_HOST || 'localhost';
  let cluster = await describe(elasticache, cacheClusterId);
  const existingEndpoint = cluster?.CacheNodes?.[0]?.Endpoint;
  if (cluster?.CacheClusterStatus === 'available' && existingEndpoint?.Port) {
    return {
      cacheClusterId,
      status: cluster.CacheClusterStatus,
      endpoint: { address: existingEndpoint.Address, port: existingEndpoint.Port },
      cacheUrl: config.cacheUrl || process.env.CACHE_URL || `redis://${host}:${existingEndpoint.Port}`,
    };
  }
  if (!cluster) {
    try {
      await elasticache.send(new CreateCacheClusterCommand({
        CacheClusterId: cacheClusterId,
        Engine: 'redis',
        EngineVersion: config.cacheEngineVersion || process.env.CACHE_ENGINE_VERSION || '7.1',
        CacheNodeType: config.cacheNodeType || process.env.CACHE_NODE_TYPE || 'cache.t3.micro',
        NumCacheNodes: 1,
        Port: port,
        AutoMinorVersionUpgrade: true,
      }));
    } catch (error) {
      if (!['CacheClusterAlreadyExists', 'CacheClusterAlreadyExistsFault'].includes(error.name)) throw error;
    }
  }

  const attempts = config.cachePollAttempts || Number.parseInt(process.env.CACHE_POLL_ATTEMPTS || '60', 10);
  const delayMs = config.cachePollDelayMs ?? Number.parseInt(process.env.CACHE_POLL_DELAY_MS || '1000', 10);
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    cluster = await describe(elasticache, cacheClusterId);
    const endpoint = cluster?.CacheNodes?.[0]?.Endpoint;
    if (cluster?.CacheClusterStatus === 'available' && endpoint?.Port) {
      return {
        cacheClusterId,
        status: cluster.CacheClusterStatus,
        endpoint: { address: endpoint.Address, port: endpoint.Port },
        cacheUrl: config.cacheUrl || process.env.CACHE_URL || `redis://${host}:${endpoint.Port}`,
      };
    }
    if (cluster?.CacheClusterStatus === 'deleting') throw new Error(`ElastiCache cluster ${cacheClusterId} is deleting`);
    await sleep(delayMs);
  }
  throw new Error(`Timed out waiting for ElastiCache cluster ${cacheClusterId} to become available`);
}

module.exports = { provision, describe };
