const { PutLogEventsCommand } = require('@aws-sdk/client-cloudwatch-logs');

function createLogger({ sink = console, cloudWatchLogs, logGroupName = '/school-bus-tracker/backend', logStreamName = 'audit' } = {}) {
  function write(level, event) {
    const record = {
      timestamp: new Date().toISOString(),
      level,
      ...(typeof event === 'string' ? { message: event } : event),
    };
    const method = level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log';
    sink[method](JSON.stringify(record));
    if (cloudWatchLogs) {
      cloudWatchLogs.send(new PutLogEventsCommand({
        logGroupName,
        logStreamName,
        logEvents: [{ timestamp: Date.parse(record.timestamp), message: JSON.stringify(record) }],
      })).catch((error) => sink.error(JSON.stringify({ timestamp: new Date().toISOString(), level: 'error', event: 'cloudwatch_log_delivery_failed', message: error.message })));
    }
  }

  return {
    info: (event) => write('info', event),
    warn: (event) => write('warn', event),
    error: (event) => write('error', event),
  };
}

module.exports = { createLogger };
