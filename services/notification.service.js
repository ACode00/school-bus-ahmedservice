const {
  DeleteMessageCommand,
  GetQueueUrlCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
} = require('@aws-sdk/client-sqs');

const ALERT_TYPE = Object.freeze({ ATTENDANCE_MARKED: 'boarding', ATTENDANCE_UPDATED: 'boarding', TRIP_TIMES_UPDATED: 'trip change', TRIP_STATUS_UPDATED: 'trip change', TRIP_CANCELLED: 'cancel' });

class NotificationService {
  constructor({ sqs, models, queueUrl, queueName = 'bus-tracker-notifications-queue', endpoint, logger, idFactory = (eventId, userId) => `${eventId}:${userId}` }) {
    Object.assign(this, { sqs, models, queueUrl, queueName, endpoint, logger, idFactory });
  }

  async resolveQueueUrl() {
    if (this.queueUrl) return this.queueUrl;
    const result = await this.sqs.send(new GetQueueUrlCommand({ QueueName: this.queueName }));
    if (!result.QueueUrl) throw new Error(`SQS queue ${this.queueName} was not found`);
    this.queueUrl = result.QueueUrl;
    if (this.endpoint) {
      const resolved = new URL(this.queueUrl);
      const local = new URL(this.endpoint);
      resolved.host = local.host;
      this.queueUrl = resolved.toString().replace(/\/$/, '');
    }
    return this.queueUrl;
  }

  async publish(event) {
    try {
      const queueUrl = await this.resolveQueueUrl();
      const payload = { ...event, event_id: event.id, occurred_at: event.created_at, outbox_status: event.status, status: event.attendance_status || event.event_status || event.status };
      const result = await this.sqs.send(new SendMessageCommand({ QueueUrl: queueUrl, MessageBody: JSON.stringify(payload) }));
      if (event.id) await this.models.notificationOutbox.update({ id: event.id }, { status: 'PUBLISHED', message_id: result.MessageId || 'sent' });
      this.logger?.info({ event: 'notification_published', event_id: event.id, message_id: result.MessageId });
      return true;
    } catch (error) {
      this.logger?.error({ event: 'notification_publish_failed', event_id: event.id, message: error.message });
      return false;
    }
  }

  async publishPending(limit = 10) {
    const pending = await this.models.notificationOutbox.findPending('PENDING', { limit });
    for (const event of pending) await this.publish(event);
    return pending.length;
  }

  async processMessage(message) {
    const event = JSON.parse(message.Body);
    const userIds = [...new Set([...(event.user_ids || []), ...(event.parent_id ? [event.parent_id] : [])])];
    const type = ALERT_TYPE[event.type] || event.type;
    for (const userId of userIds) {
      const alert = {
        id: this.idFactory(event.id || event.event_id || message.MessageId, userId), user_id: userId, type,
        message: event.message || 'There is an update to your school bus route', is_read: false,
        created_at: event.created_at || new Date().toISOString(),
        event_id: event.id || event.event_id || message.MessageId,
        ...(event.student_id ? { student_id: event.student_id } : {}),
        ...(event.trip_id ? { trip_id: event.trip_id } : {}),
      };
      try { await this.models.alerts.create(alert); }
      catch (error) {
        if (!['ConditionalCheckFailedException', 'TransactionCanceledException'].includes(error.name)) throw error;
      }
    }
    await this.sqs.send(new DeleteMessageCommand({ QueueUrl: await this.resolveQueueUrl(), ReceiptHandle: message.ReceiptHandle }));
    this.logger?.info({ event: 'notification_processed', event_id: event.id, users: userIds.length });
  }

  async pollOnce() {
    const result = await this.sqs.send(new ReceiveMessageCommand({ QueueUrl: await this.resolveQueueUrl(), MaxNumberOfMessages: 10, WaitTimeSeconds: 1, VisibilityTimeout: 30 }));
    for (const message of result.Messages || []) {
      try { await this.processMessage(message); }
      catch (error) { this.logger?.error({ event: 'notification_processing_failed', message_id: message.MessageId, message: error.message }); }
    }
    return (result.Messages || []).length;
  }

  async run({ signal, pollIntervalMs = 1_000 } = {}) {
    while (!signal?.aborted) {
      try { await this.publishPending(); await this.pollOnce(); }
      catch (error) { this.logger?.error({ event: 'notification_worker_failed', message: error.message }); }
      if (!signal?.aborted) await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }
  }
}

module.exports = { NotificationService, ALERT_TYPE };
