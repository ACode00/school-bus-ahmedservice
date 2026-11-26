const { AppError } = require('../middleware/error-handler');

class EtaService {
  constructor({ models, db, cache, notificationService, idFactory = () => require('node:crypto').randomUUID(), now = () => new Date().toISOString() }) {
    Object.assign(this, { models, db, cache, notificationService, idFactory, now });
  }

  async getTripEta(tripId) {
    const result = await this.cache.getOrLoad(`trip:eta:${tripId}`, async () => {
      const trip = await this.models.trips.get({ id: tripId });
      if (!trip) throw new AppError(404, 'TRIP_NOT_FOUND', 'Trip was not found');
      const [windows, stops] = await Promise.all([
        this.models.tripStops.queryPartition(tripId),
        this.models.stops.findByRouteId(trip.route_id),
      ]);
      const order = new Map(stops.map((stop) => [stop.id, Number(stop.stop_order)]));
      windows.sort((a, b) => (order.get(a.stop_id) ?? Infinity) - (order.get(b.stop_id) ?? Infinity));
      const stopById = new Map(stops.map((stop) => [stop.id, stop]));
      const schedule = windows.map((window) => ({ ...window, name: stopById.get(window.stop_id)?.name, stop_order: stopById.get(window.stop_id)?.stop_order }));
      return {
        trip_id: trip.id,
        route_id: trip.route_id,
        bus_id: trip.bus_id,
        run_type: trip.run_type,
        service_date: trip.service_date || trip.date,
        cancelled_date: trip.cancelled_date,
        status: trip.status,
        stops: schedule,
      };
    });
    return result;
  }

  async replaceTripTimes(tripId, stops, actorId) {
    const trip = await this.models.trips.get({ id: tripId });
    if (!trip) throw new AppError(404, 'TRIP_NOT_FOUND', 'Trip was not found');
    const routeStops = await this.models.stops.findByRouteId(trip.route_id);
    const known = new Map(routeStops.map((stop) => [stop.id, stop]));
    if (stops.some((item) => !known.has(item.stop_id))) throw new AppError(400, 'INVALID_STOP', 'Every stop must belong to the trip route');
    if (new Set(stops.map((item) => item.stop_id)).size !== stops.length) throw new AppError(400, 'DUPLICATE_STOP', 'Each stop may appear once');
    if (stops.length !== routeStops.length) throw new AppError(400, 'INCOMPLETE_SCHEDULE', 'A complete schedule for the trip route is required');
    const ordered = [...stops].sort((a, b) => Number(known.get(a.stop_id).stop_order) - Number(known.get(b.stop_id).stop_order));
    const previous = await this.models.tripStops.queryPartition(tripId);
    const students = await this.models.students.findByBusId(trip.bus_id);
    const parents = [...new Set(students.map((student) => student.parent_id).filter(Boolean))];
    const outbox = {
      id: this.idFactory(), status: 'PENDING', created_at: this.now(), type: 'TRIP_TIMES_UPDATED',
      event_status: 'updated', trip_id: tripId, user_ids: parents, message: 'Trip arrival times were updated', actor_id: actorId,
    };
    const nextStopIds = new Set(ordered.map((item) => item.stop_id));
    const operations = [
      ...previous.filter((item) => !nextStopIds.has(item.stop_id)).map((item) => ({ Delete: { TableName: this.models.tripStops.tableName, Key: { trip_id: item.trip_id, stop_id: item.stop_id } } })),
      ...ordered.map((item) => ({ Put: { TableName: this.models.tripStops.tableName, Item: { trip_id: tripId, ...item } } })),
      { Put: { TableName: this.models.notificationOutbox.tableName, Item: outbox } },
    ];
    if (operations.length > 100) throw new AppError(400, 'SCHEDULE_TOO_LARGE', 'Trip schedule exceeds transaction limit');
    await this.db.send(new (require('@aws-sdk/lib-dynamodb').TransactWriteCommand)({ TransactItems: operations }));
    await this.notificationService?.publish(outbox);
    await this.cache.invalidate(`trip:eta:${tripId}`);
    return { trip_id: tripId, stops: ordered };
  }
}

module.exports = { EtaService };
