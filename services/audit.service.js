const crypto = require('node:crypto');
const { PutLogEventsCommand } = require('@aws-sdk/client-cloudwatch-logs');

class AuditService {
  constructor({ model, logger, cloudWatchLogs, logGroupName = '/school-bus-tracker/backend', logStreamName = 'audit', now = Date.now }) {
    this.model = model;
    this.logger = logger;
    this.cloudWatchLogs = cloudWatchLogs;
    this.logGroupName = logGroupName;
    this.logStreamName = logStreamName;
    this.now = now;
  }

  async record({ userId = 'anonymous', event, status, metadata = {} }) {
    const item = {
      id: crypto.randomUUID(),
      user_id: userId,
      event,
      status,
      created_at: new Date(this.now()).toISOString(),
      ...(Object.keys(metadata).length ? { metadata } : {}),
    };
    await this.model.create(item);
    if (!this.cloudWatchLogs) this.logger?.info({ ...item, category: 'audit' });
    if (this.cloudWatchLogs) {
      await this.cloudWatchLogs.send(new PutLogEventsCommand({
        logGroupName: this.logGroupName,
        logStreamName: this.logStreamName,
        logEvents: [{ timestamp: Date.parse(item.created_at), message: JSON.stringify({ ...item, category: 'audit' }) }],
      }));
    }
    return item;
  }
}

async function recordSafely(auditService, entry, logger) {
  try { await auditService?.record(entry); }
  catch (error) { logger?.error({ event: 'audit_write_failed', audit_event: entry.event, message: error.message }); }
}

module.exports = { AuditService, recordSafely };
