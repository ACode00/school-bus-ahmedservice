const { z } = require('zod');
const { AppError } = require('../middleware/error-handler');
const { isIsoDate } = require('../utils/date');
const holidaySchema = z.object({ date: z.string().refine(isIsoDate), name: z.string().trim().min(1).max(160), year: z.string().regex(/^\d{4}$/) }).strict();

function createHolidaysController({ models, cache, idFactory = () => require('node:crypto').randomUUID() }) {
  const invalidate = (year) => cache.invalidate(`holidays:${year}`);
  return {
    async list(req, res, next) { try {
      const year = req.query.year;
      if (!/^\d{4}$/.test(year || '')) throw new AppError(400, 'INVALID_YEAR', 'A four-digit year is required');
      const result = await cache.getOrLoad(`holidays:${year}`, () => models.holidays.findByYear(year, { limit: 100 }));
      res.set('X-Cache', result.cacheStatus).json(result.value);
    } catch (error) { next(error); } },
    async create(req, res, next) { try {
      const parsed = holidaySchema.safeParse(req.body);
      if (!parsed.success || parsed.data.date.slice(0, 4) !== parsed.data.year) throw new AppError(400, 'INVALID_HOLIDAY', 'Valid date, name, and matching year are required');
      const holiday = await models.holidays.create({ id: idFactory(), ...parsed.data }); await invalidate(parsed.data.year); res.status(201).json(holiday);
    } catch (error) { next(error); } },
    async update(req, res, next) { try {
      const parsed = holidaySchema.partial().strict().safeParse(req.body);
      if (!parsed.success || !Object.keys(parsed.data || {}).length) throw new AppError(400, 'INVALID_HOLIDAY', 'At least one valid holiday field is required');
      const existing = await models.holidays.get({ id: req.params.id }); if (!existing) throw new AppError(404, 'HOLIDAY_NOT_FOUND', 'Holiday was not found');
      const changes = { ...parsed.data };
      if ((changes.date || existing.date).slice(0, 4) !== (changes.year || existing.year)) throw new AppError(400, 'INVALID_HOLIDAY', 'Holiday year must match its date');
      const updated = await models.holidays.update({ id: existing.id }, changes); await invalidate(existing.year); if (updated.year !== existing.year) await invalidate(updated.year); res.json(updated);
    } catch (error) { next(error); } },
    async remove(req, res, next) { try {
      const holiday = await models.holidays.delete({ id: req.params.id }); if (!holiday) throw new AppError(404, 'HOLIDAY_NOT_FOUND', 'Holiday was not found');
      await invalidate(holiday.year); res.status(204).end();
    } catch (error) { next(error); } },
  };
}
module.exports = { createHolidaysController };
