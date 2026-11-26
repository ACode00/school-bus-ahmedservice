const { z } = require('zod');
const { AppError } = require('../middleware/error-handler');

const routeSchema = z.object({ code: z.string().min(1), name: z.string().min(1), area: z.string().min(1) }).strict();
const stopSchema = z.object({ name: z.string().min(1), stop_order: z.number().int().positive() }).strict();

function createRoutesController({ models, cache, idFactory = () => require('node:crypto').randomUUID() }) {
  const cached = async (key, loader, res) => { const result = await cache.getOrLoad(key, loader); res.set('X-Cache', result.cacheStatus); return result.value; };
  const invalidateRoute = async (id) => {
    await Promise.all([
      cache.invalidatePrefix('routes:'), cache.invalidatePrefix('stop:'), cache.invalidatePrefix('trip:eta:'),
      ...(id ? [cache.invalidatePrefix(`route:${id}:`)] : []),
    ]);
  };
  return {
    async list(req, res, next) { try {
      const name = req.query.name?.trim(); const area = req.query.area?.trim();
      const key = `routes:list:${name || '*'}:${area || '*'}`;
      res.json(await cached(key, async () => {
        let routes;
        if (name && area) {
          const [byName, byArea] = await Promise.all([models.routes.findByName(name, { limit: 100 }), models.routes.findByArea(area, { limit: 100 })]);
          const ids = new Set(byArea.map((x) => x.id)); routes = byName.filter((x) => ids.has(x.id)).slice(0, 100);
        } else if (name) routes = (await models.routes.findByName(name, { limit: 100 })).slice(0, 100);
        else if (area) routes = (await models.routes.findByArea(area, { limit: 100 })).slice(0, 100);
        else routes = await models.routes.list({ limit: 100 });
        return routes;
      }, res));
    } catch (e) { next(e); } },
    async get(req, res, next) { try {
      const route = await cached(`route:${req.params.id}:detail`, async () => models.routes.get({ id: req.params.id }), res);
      if (!route) throw new AppError(404, 'ROUTE_NOT_FOUND', 'Route was not found'); res.json(route);
    } catch (e) { next(e); } },
    async stops(req, res, next) { try {
      const route = await models.routes.get({ id: req.params.id }); if (!route) throw new AppError(404, 'ROUTE_NOT_FOUND', 'Route was not found');
      res.json(await cached(`route:${req.params.id}:stops`, () => models.stops.findByRouteId(req.params.id, { limit: 100 }), res));
    } catch (e) { next(e); } },
    async getStop(req, res, next) { try {
      const stop = await cached(`stop:${req.params.id}:detail`, () => models.stops.get({ id: req.params.id }), res);
      if (!stop) throw new AppError(404, 'STOP_NOT_FOUND', 'Stop was not found'); res.json(stop);
    } catch (e) { next(e); } },
    async create(req, res, next) { try {
      const parsed = routeSchema.safeParse(req.body); if (!parsed.success) throw new AppError(400, 'INVALID_ROUTE', 'Valid code, name, and area are required');
      const route = await models.routes.create({ id: idFactory(), ...parsed.data }); await invalidateRoute(); res.status(201).json(route);
    } catch (e) { next(e); } },
    async update(req, res, next) { try {
      const parsed = routeSchema.partial().strict().safeParse(req.body); if (!parsed.success || !Object.keys(parsed.data || {}).length) throw new AppError(400, 'INVALID_ROUTE', 'At least one valid route field is required');
      if (!await models.routes.get({ id: req.params.id })) throw new AppError(404, 'ROUTE_NOT_FOUND', 'Route was not found');
      const route = await models.routes.update({ id: req.params.id }, parsed.data); await invalidateRoute(req.params.id); res.json(route);
    } catch (e) { next(e); } },
    async remove(req, res, next) { try {
      if (!await models.routes.get({ id: req.params.id })) throw new AppError(404, 'ROUTE_NOT_FOUND', 'Route was not found');
      const [trips, buses] = await Promise.all([models.trips.findByRouteId(req.params.id), models.buses.findByRouteId(req.params.id)]);
      if (trips.length || buses.length) throw new AppError(409, 'ROUTE_IN_USE', 'Route has trips or buses assigned');
      const stops = await models.stops.findByRouteId(req.params.id);
      for (const stop of stops) await models.stops.delete({ id: stop.id });
      const result = await models.routes.delete({ id: req.params.id }); if (!result) throw new AppError(404, 'ROUTE_NOT_FOUND', 'Route was not found'); await invalidateRoute(req.params.id); res.status(204).end();
    } catch (e) { next(e); } },
    async createStop(req, res, next) { try {
      const parsed = stopSchema.safeParse(req.body); if (!parsed.success) throw new AppError(400, 'INVALID_STOP', 'Valid stop name and order are required');
      const route = await models.routes.get({ id: req.params.id }); if (!route) throw new AppError(404, 'ROUTE_NOT_FOUND', 'Route was not found');
      const stop = await models.stops.create({ id: idFactory(), route_id: route.id, ...parsed.data }); await invalidateRoute(route.id); res.status(201).json(stop);
    } catch (e) { next(e); } },
    async updateStop(req, res, next) { try {
      const parsed = stopSchema.partial().strict().safeParse(req.body); if (!parsed.success || !Object.keys(parsed.data || {}).length) throw new AppError(400, 'INVALID_STOP', 'At least one valid stop field is required');
      const stop = await models.stops.get({ id: req.params.stopId }); if (!stop || stop.route_id !== req.params.id) throw new AppError(404, 'STOP_NOT_FOUND', 'Stop was not found');
      const result = await models.stops.update({ id: stop.id }, parsed.data); await invalidateRoute(stop.route_id); res.json(result);
    } catch (e) { next(e); } },
    async removeStop(req, res, next) { try {
      const stop = await models.stops.get({ id: req.params.stopId }); if (!stop || stop.route_id !== req.params.id) throw new AppError(404, 'STOP_NOT_FOUND', 'Stop was not found');
      const [students, trips] = await Promise.all([models.students.findByStopId(stop.id), models.trips.findByRouteId(req.params.id)]);
      let scheduled = false;
      for (const trip of trips) {
        const tripStops = await models.tripStops.queryPartition(trip.id);
        if (tripStops.some((item) => item.stop_id === stop.id)) { scheduled = true; break; }
      }
      if (students.length || scheduled) throw new AppError(409, 'STOP_IN_USE', 'Stop is used by a student or trip schedule');
      await models.stops.delete({ id: stop.id }); await invalidateRoute(req.params.id); res.status(204).end();
    } catch (e) { next(e); } },
  };
}

module.exports = { createRoutesController };
