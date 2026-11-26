const { CreateCacheClusterCommand, DescribeCacheClustersCommand } = require('@aws-sdk/client-elasticache');
const { provision } = require('../../scripts/provision/cache');

test('creates a single-node Redis ElastiCache cluster and returns its connection URL', async () => {
  const client = { send: jest.fn()
    .mockResolvedValueOnce({ CacheClusters: [] })
    .mockResolvedValueOnce({ CacheCluster: { CacheClusterId: 'bus-cache', CacheClusterStatus: 'creating' } })
    .mockResolvedValueOnce({ CacheClusters: [{ CacheClusterId: 'bus-cache', CacheClusterStatus: 'available', CacheNodes: [{ Endpoint: { Address: 'floci', Port: 6379 } }] }] }) };
  const result = await provision({ elasticache: client }, { cacheClusterId: 'bus-cache', cacheHost: 'localhost', cachePort: 6379, cachePollAttempts: 2, cachePollDelayMs: 0 });
  const create = client.send.mock.calls[1][0];
  expect(create).toBeInstanceOf(CreateCacheClusterCommand);
  expect(create.input).toMatchObject({ CacheClusterId: 'bus-cache', Engine: 'redis', NumCacheNodes: 1, Port: 6379 });
  expect(client.send.mock.calls[2][0]).toBeInstanceOf(DescribeCacheClustersCommand);
  expect(result).toMatchObject({ status: 'available', cacheUrl: 'redis://localhost:6379' });
});

test('reuses an already available cache cluster without creating another', async () => {
  const client = { send: jest.fn().mockResolvedValue({ CacheClusters: [{ CacheClusterId: 'bus-cache', CacheClusterStatus: 'available', CacheNodes: [{ Endpoint: { Address: 'floci', Port: 6381 } }] }] }) };
  const result = await provision({ elasticache: client }, { cacheClusterId: 'bus-cache', cacheHost: 'cache-host', cachePollDelayMs: 0 });
  expect(client.send).toHaveBeenCalledTimes(1);
  expect(result.cacheUrl).toBe('redis://cache-host:6381');
});
