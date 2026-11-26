const { CacheService } = require('../../services/cache.service');
const { createRedisTestClient } = require('../helpers/redis-client');

describe('ElastiCache-backed CacheService', () => {
  test('returns MISS then HIT using a shared Redis value with a TTL', async () => {
    const redis = createRedisTestClient(); const cache = new CacheService({ client: redis, defaultTtlMs: 1000 });
    const loader = jest.fn().mockResolvedValue({ eta: '07:15' });
    const first = await cache.getOrLoad('trip:eta:t-1', loader);
    const second = await cache.getOrLoad('trip:eta:t-1', loader);
    expect(first).toEqual({ value: { eta: '07:15' }, cacheStatus: 'MISS' });
    expect(second).toEqual({ value: { eta: '07:15' }, cacheStatus: 'HIT' });
    expect(redis.set).toHaveBeenCalledWith(expect.stringContaining('trip:eta:t-1'), JSON.stringify({ eta: '07:15' }), { PX: 1000 });
    expect(loader).toHaveBeenCalledTimes(1);
  });

  test('Redis TTL expiry causes the next read to reload', async () => {
    let now = 100; const redis = createRedisTestClient({ now: () => now });
    const cache = new CacheService({ client: redis, defaultTtlMs: 10 });
    const loader = jest.fn().mockResolvedValueOnce('first').mockResolvedValueOnce('second');
    await cache.getOrLoad('routes:list:all', loader);
    now = 111;
    expect(await cache.getOrLoad('routes:list:all', loader)).toEqual({ value: 'second', cacheStatus: 'MISS' });
  });

  test('exact and prefix invalidation delete shared ElastiCache entries', async () => {
    const redis = createRedisTestClient(); const cache = new CacheService({ client: redis });
    await cache.getOrLoad('route:r-1:stops', async () => ['stop']);
    await cache.getOrLoad('route:r-1:detail', async () => ({ name: 'Route' }));
    await cache.getOrLoad('route:r-2:detail', async () => ({ name: 'Other' }));
    await cache.invalidatePrefix('route:r-1:');
    expect((await cache.getOrLoad('route:r-1:stops', async () => ['fresh'])).cacheStatus).toBe('MISS');
    await cache.invalidate('route:r-2:detail');
    expect((await cache.getOrLoad('route:r-2:detail', async () => ({ name: 'New' }))).cacheStatus).toBe('MISS');
  });

  test('does not cache rejected loaders and permits a later retry', async () => {
    const redis = createRedisTestClient(); const cache = new CacheService({ client: redis });
    const loader = jest.fn().mockRejectedValueOnce(new Error('temporary')).mockResolvedValueOnce('recovered');
    await expect(cache.getOrLoad('holiday:2026', loader)).rejects.toThrow('temporary');
    await expect(cache.getOrLoad('holiday:2026', loader)).resolves.toMatchObject({ value: 'recovered', cacheStatus: 'MISS' });
  });
});
