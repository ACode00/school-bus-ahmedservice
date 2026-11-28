const crypto = require('node:crypto');

// Stops password guessing on POST /api/sessions.
// After 3 wrong logins for one email inside 10 minutes, that email is blocked
// until the window ends (HTTP 429 + Retry-After).
// A per-IP limit is also available (maxIpFailures), but it is OFF by default:
// behind API Gateway every request reaches ECS from the gateway's address, so an
// IP limit would lock out every user at once. Turn it on only when the real
// client IP reaches the app.
// Counts live in Redis (ElastiCache), so every ECS copy of the API sees the same
// numbers. Without Redis (unit tests) an in-memory map is used instead.

const DEFAULTS = { maxFailures: 3, maxIpFailures: 0, windowSeconds: 600 };

function hash(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 32);
}

class MemoryStore {
  constructor(now = () => Date.now()) {
    this.items = new Map();
    this.now = now;
  }

  live(key) {
    const item = this.items.get(key);
    if (item && item.expiresAt <= this.now()) {
      this.items.delete(key);
      return null;
    }
    return item || null;
  }

  async get(key) { return this.live(key)?.count || 0; }

  async ttl(key) {
    const item = this.live(key);
    return item ? Math.ceil((item.expiresAt - this.now()) / 1000) : 0;
  }

  async incr(key, windowSeconds) {
    const item = this.live(key);
    if (item) { item.count += 1; return item.count; }
    this.items.set(key, { count: 1, expiresAt: this.now() + windowSeconds * 1000 });
    return 1;
  }

  async del(key) { this.items.delete(key); }
}

class RedisStore {
  constructor(client) { this.client = client; }

  async get(key) { return Number(await this.client.get(key)) || 0; }

  async ttl(key) { return Math.max(Number(await this.client.ttl(key)) || 0, 0); }

  async incr(key, windowSeconds) {
    const count = await this.client.incr(key);
    if (count === 1) await this.client.expire(key, windowSeconds);
    return count;
  }

  async del(key) { await this.client.del(key); }
}

class LoginLimiter {
  constructor({ client = null, store = null, logger = null, ...options } = {}) {
    this.options = { ...DEFAULTS, ...options };
    this.store = store || (client ? new RedisStore(client) : new MemoryStore());
    this.logger = logger;
  }

  keys(email, ip) {
    return {
      email: `school-bus-tracker:login-fail:email:${hash(email)}`,
      ip: `school-bus-tracker:login-fail:ip:${hash(ip || 'unknown')}`,
    };
  }

  // Returns { blocked: true, retryAfter } when this email or this IP is over the limit.
  async check(email, ip) {
    const keys = this.keys(email, ip);
    try {
      const emailCount = await this.store.get(keys.email);
      const ipCount = this.options.maxIpFailures > 0 ? await this.store.get(keys.ip) : 0;
      if (emailCount >= this.options.maxFailures) return { blocked: true, retryAfter: await this.retryAfter(keys.email) };
      if (this.options.maxIpFailures > 0 && ipCount >= this.options.maxIpFailures) return { blocked: true, retryAfter: await this.retryAfter(keys.ip) };
    } catch (error) {
      // If Redis is down we do not lock everyone out. We log it and let bcrypt decide.
      this.logger?.warn({ event: 'login_limiter_unavailable', message: error.message });
    }
    return { blocked: false, retryAfter: 0 };
  }

  async retryAfter(key) {
    const seconds = await this.store.ttl(key);
    return seconds > 0 ? seconds : this.options.windowSeconds;
  }

  async recordFailure(email, ip) {
    const keys = this.keys(email, ip);
    try {
      await this.store.incr(keys.email, this.options.windowSeconds);
      if (this.options.maxIpFailures > 0) await this.store.incr(keys.ip, this.options.windowSeconds);
    } catch (error) {
      this.logger?.warn({ event: 'login_limiter_unavailable', message: error.message });
    }
  }

  // A correct login before the limit clears the count for that email.
  async reset(email) {
    try { await this.store.del(this.keys(email).email); }
    catch (error) { this.logger?.warn({ event: 'login_limiter_unavailable', message: error.message }); }
  }
}

module.exports = { LoginLimiter, MemoryStore, RedisStore, DEFAULTS };
