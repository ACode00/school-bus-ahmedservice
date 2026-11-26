class CacheService {
  constructor({ client, defaultTtlMs = 60_000, logger = null, namespace = 'school-bus-tracker:cache:' } = {}) {
    if (!client) throw new Error('An ElastiCache Redis client is required');
    this.client = client;
    this.defaultTtlMs = defaultTtlMs;
    this.logger = logger;
    this.namespace = namespace;
    this.inflight = new Map();
  }

  redisKey(key) { return `${this.namespace}${key}`; }

  async getOrLoad(key, loader, ttlMs = this.defaultTtlMs) {
    const redisKey = this.redisKey(key);
    try {
      const raw = await this.client.get(redisKey);
      if (raw !== null) {
        this.logger?.info({ event: 'cache', key, status: 'HIT', backend: 'elasticache' });
        return { value: JSON.parse(raw), cacheStatus: 'HIT' };
      }
    } catch (error) {
      this.logger?.warn({ event: 'cache_read_failed', key, backend: 'elasticache', message: error.message });
    }

    if (this.inflight.has(key)) {
      const value = await this.inflight.get(key);
      this.logger?.info({ event: 'cache', key, status: 'HIT', backend: 'elasticache' });
      return { value, cacheStatus: 'HIT' };
    }

    const pending = Promise.resolve().then(loader);
    this.inflight.set(key, pending);
    try {
      const value = await pending;
      if (ttlMs > 0 && this.inflight.get(key) === pending) {
        try { await this.client.set(redisKey, JSON.stringify(value), { PX: ttlMs }); }
        catch (error) { this.logger?.warn({ event: 'cache_write_failed', key, backend: 'elasticache', message: error.message }); }
      }
      this.logger?.info({ event: 'cache', key, status: 'MISS', backend: 'elasticache' });
      return { value, cacheStatus: 'MISS' };
    } finally {
      if (this.inflight.get(key) === pending) this.inflight.delete(key);
    }
  }

  async invalidate(key) {
    this.inflight.delete(key);
    return this.client.del(this.redisKey(key));
  }

  async invalidatePrefix(prefix) {
    this.inflight.clear();
    const match = `${this.redisKey(prefix)}*`;
    let removed = 0;
    let batch = [];
    for await (const key of this.client.scanIterator({ MATCH: match, COUNT: 100 })) {
      batch.push(key);
      if (batch.length >= 100) {
        removed += await this.client.unlink(batch);
        batch = [];
      }
    }
    if (batch.length) removed += await this.client.unlink(batch);
    return removed;
  }

  async clear() {
    return this.invalidatePrefix('');
  }
}

module.exports = { CacheService };
