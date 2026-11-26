const { z } = require('zod');
const { AppError } = require('../middleware/error-handler');
const { EtaService } = require('../services/eta.service');
const { TransactWriteCommand } = require('@aws-sdk/lib-dynamodb');
const { recordSafely } = require('../services/audit.service');
const { isIsoDate } = require('../utils/date');

const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const timesSchema = z.object({ stops: z.array(z.object({ stop_id: z.string().min(1), arrive_from: timeSchema, arrive_to: timeSchema }).strict()).min(1).max(98) }).strict();
const statusSchema = z.object({ status: z.enum(['scheduled', 'in_progress', 'completed', 'cancelled']), cancelled_date: z.string().refine(isIsoDate).optional() }).strict();

function createTripsController(services) {
  const eta = services.etaService || new EtaService({ models: services.models, db: services.db, cache: services.cache, notificationService: services.notificationService, idFactory: services.idFactory });
  return {
    async getEta(req, res, next) {
      try {
        const result = await eta.getTripEta(req.params.id);
        res.set('X-Cache', result.cacheStatus);
        res.json(result.value);
      } catch (error) { next(error); }
    },
    async putTimes(req, res, next) {
      try {
        const parsed = timesSchema.safeParse(req.body);
        if (!parsed.success || parsed.data.stops.some((stop) => stop.arrive_from > stop.arrive_to)) {
          throw new AppError(400, 'INVALID_SCHEDULE', 'Valid arrival windows for every stop are required');
        }
        const result = await eta.replaceTripTimes(req.params.id, parsed.data.stops, req.user.id);
        await recordSafely(services.auditService, { userId: req.user.id, event: 'trip_times_updated', status: 'success', metadata: { trip_id: req.params.id } }, services.logger);
        services.logger?.info({ event: 'trip_times_updated', user_id: req.user.id, trip_id: req.params.id });
        res.json(result);
      } catch (error) { next(error); }
    },
    async patchStatus(req, res, next) {
      try {
        const parsed = statusSchema.safeParse(req.body);
        if (!parsed.success || (parsed.data.status === 'cancelled' && !parsed.data.cancelled_date)) throw new AppError(400, 'INVALID_TRIP_STATUS', 'Valid trip status and cancellation date are required');
        const trip = await services.models.trips.get({ id: req.params.id });
        if (!trip) throw new AppError(404, 'TRIP_NOT_FOUND', 'Trip was not found');
        const students = await services.models.students.findByBusId(trip.bus_id);
        const userIds = [...new Set(students.map((student) => student.parent_id).filter(Boolean))];
        const event = {
          id: (services.idFactory || (() => require('node:crypto').randomUUID()))(), status: 'PENDING', created_at: new Date().toISOString(),
          type: parsed.data.status === 'cancelled' ? 'TRIP_CANCELLED' : 'TRIP_STATUS_UPDATED', event_status: parsed.data.status,
          trip_id: trip.id, user_ids: userIds, message: parsed.data.status === 'cancelled' ? 'Trip was cancelled' : `Trip status changed to ${parsed.data.status}`,
        };
        const updatedAt = new Date().toISOString();
        const update = parsed.data.status === 'cancelled'
          ? { UpdateExpression: 'SET #status = :status, #updatedAt = :updatedAt, #cancelledDate = :cancelledDate', ExpressionAttributeNames: { '#id': 'id', '#status': 'status', '#updatedAt': 'updated_at', '#cancelledDate': 'cancelled_date' }, ExpressionAttributeValues: { ':status': parsed.data.status, ':updatedAt': updatedAt, ':cancelledDate': parsed.data.cancelled_date } }
          : { UpdateExpression: 'SET #status = :status, #updatedAt = :updatedAt REMOVE #cancelledDate', ExpressionAttributeNames: { '#id': 'id', '#status': 'status', '#updatedAt': 'updated_at', '#cancelledDate': 'cancelled_date' }, ExpressionAttributeValues: { ':status': parsed.data.status, ':updatedAt': updatedAt } };
        await services.db.send(new TransactWriteCommand({ TransactItems: [
          { Update: { TableName: services.models.trips.tableName, Key: { id: trip.id }, ...update, ConditionExpression: 'attribute_exists(#id)' } },
          { Put: { TableName: services.models.notificationOutbox.tableName, Item: event } },
        ] }));
        await services.cache.invalidate(`trip:eta:${trip.id}`);
        await services.notificationService?.publish(event);
        await recordSafely(services.auditService, { userId: req.user.id, event: 'trip_status_updated', status: 'success', metadata: { trip_id: trip.id, trip_status: parsed.data.status } }, services.logger);
        res.json({ ...trip, status: parsed.data.status, ...(parsed.data.cancelled_date ? { cancelled_date: parsed.data.cancelled_date } : {}), updated_at: updatedAt });
      } catch (error) { next(error); }
    },
  };
}

module.exports = { createTripsController };
