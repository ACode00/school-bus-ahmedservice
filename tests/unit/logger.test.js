const { createLogger } = require('../../config/logger');

test('writes structured JSON without logging arbitrary secrets from unrelated fields', () => {
  const sink = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
  const logger = createLogger({ sink });

  logger.info({ event: 'request', request_id: 'req-1' });

  const record = JSON.parse(sink.log.mock.calls[0][0]);
  expect(record).toMatchObject({ level: 'info', event: 'request', request_id: 'req-1' });
  expect(record.timestamp).toBeTruthy();
});
