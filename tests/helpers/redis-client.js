function createRedisTestClient({ now = Date.now } = {}) {
  const values = new Map();
  return {
    values,
    get: jest.fn(async (key) => {
      const entry = values.get(key);
      if (!entry) return null;
      if (entry.expiresAt <= now()) { values.delete(key); return null; }
      return entry.value;
    }),
    set: jest.fn(async (key, value, options = {}) => {
      values.set(key, { value, expiresAt: now() + (options.PX ?? Number.MAX_SAFE_INTEGER) });
      return 'OK';
    }),
    del: jest.fn(async (...keys) => keys.reduce((count, key) => count + Number(values.delete(key)), 0)),
    unlink: jest.fn(async (...keys) => keys.flat().reduce((count, key) => count + Number(values.delete(key)), 0)),
    async *scanIterator({ MATCH }) {
      const prefix = MATCH.endsWith('*') ? MATCH.slice(0, -1) : MATCH;
      for (const key of values.keys()) if (key.startsWith(prefix)) yield key;
    },
    quit: jest.fn(async () => 'OK'),
    connect: jest.fn(async () => undefined),
  };
}

module.exports = { createRedisTestClient };
