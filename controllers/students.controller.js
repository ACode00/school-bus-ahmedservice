const { z } = require('zod');
const { AppError } = require('../middleware/error-handler');

const studentSchema = z.object({ name: z.string().trim().min(1).max(120), parent_id: z.string().min(1), stop_id: z.string().min(1), bus_id: z.string().min(1) }).strict();

function createStudentsController({ models, idFactory = () => require('node:crypto').randomUUID() }) {
  return { async create(req, res, next) { try {
    const parsed = studentSchema.safeParse(req.body); if (!parsed.success) throw new AppError(400, 'INVALID_STUDENT', 'Valid name, parent, stop, and bus are required');
    const [parent, stop, bus] = await Promise.all([
      models.users.get({ id: parsed.data.parent_id }), models.stops.get({ id: parsed.data.stop_id }), models.buses.get({ id: parsed.data.bus_id }),
    ]);
    if (!parent || parent.role !== 'parent') throw new AppError(404, 'PARENT_NOT_FOUND', 'Parent was not found');
    if (!stop) throw new AppError(404, 'STOP_NOT_FOUND', 'Stop was not found');
    if (!bus) throw new AppError(404, 'BUS_NOT_FOUND', 'Bus was not found');
    if (stop.route_id !== bus.route_id) throw new AppError(409, 'BUS_STOP_MISMATCH', 'The stop and bus must use the same route');
    const student = await models.students.create({ id: idFactory(), ...parsed.data });
    res.status(201).json(student);
  } catch (error) { next(error); } } };
}
module.exports = { createStudentsController };
