const { EventEmitter } = require('node:events');
const { createRedisClient } = require('../../services/redis-client');

test('Redis client logs socket diagnostics and stops reconnecting after the configured attempts', () => {
  let options;
  const redis = new EventEmitter();
  const logger = { error: jest.fn() };
  createRedisClient({ cacheUrl: 'redis://localhost:6379', cacheConnectRetries: 4 }, logger, (value) => { options = value; return redis; });

  expect(options.socket.reconnectStrategy(0)).toBe(0);
  expect(options.socket.reconnectStrategy(3)).toBe(750);
  expect(options.socket.reconnectStrategy(4)).toBeInstanceOf(Error);

  const error = Object.assign(new Error(''), { code: 'ECONNREFUSED', syscall: 'connect', address: '127.0.0.1', port: 6379 });
  redis.emit('error', error);
  expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({
    event: 'elasticache_connection_error', message: 'ECONNREFUSED', error_code: 'ECONNREFUSED',
    syscall: 'connect', address: '127.0.0.1', port: 6379, host: 'localhost',
  }));
});
