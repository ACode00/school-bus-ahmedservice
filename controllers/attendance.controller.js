const { z } = require('zod');
const { TransactWriteCommand } = require('@aws-sdk/lib-dynamodb');
const { AppError } = require('../middleware/error-handler');
const { recordSafely } = require('../services/audit.service');
const { isIsoDate } = require('../utils/date');

const isoDate = z.string().refine(isIsoDate);
const markSchema = z.object({ student_id: z.string().min(1), date: isoDate, status: z.enum(['boarded', 'almost dropped', 'dropped']) }).strict();
const updateSchema = z.object({ status: z.enum(['boarded', 'almost dropped', 'dropped']) }).strict();

function parsePage(req, partitionAttribute, partitionValue) {
  const limit = req.query.limit === undefined ? 100 : Number(req.query.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new AppError(400, 'INVALID_LIMIT', 'limit must be an integer from 1 to 100');
  if (!req.query.cursor) return { limit };
  try {
    const cursor = JSON.parse(Buffer.from(req.query.cursor, 'base64url').toString('utf8'));
    const keys = cursor && typeof cursor === 'object' && !Array.isArray(cursor) ? Object.keys(cursor).sort() : [];
    if (keys.length !== 2 || keys[0] !== 'id' || keys[1] !== partitionAttribute || typeof cursor.id !== 'string' || cursor[partitionAttribute] !== partitionValue) {
      throw new Error('cursor key mismatch');
    }
    return { limit, exclusiveStartKey: cursor };
  }
  catch { throw new AppError(400, 'INVALID_CURSOR', 'cursor is invalid'); }
}

function createAttendanceController({ models, db, auditService, notificationService, logger, idFactory = () => require('node:crypto').randomUUID(), now = () => new Date().toISOString() }) {
  const attendanceId = (tripId, date, studentId) => `att-${require('node:crypto').createHash('sha256').update(`${tripId}:${date}:${studentId}`).digest('hex')}`;
  const isConflict = (error) => ['TransactionCanceledException', 'ConditionalCheckFailedException'].includes(error?.name);
  async function assertSupervisorOwnsBus(user, busId) {
    const buses = await models.buses.findBySupervisorId(user.id);
    if (!buses.some((bus) => bus.id === busId)) {
      await recordSafely(auditService, { userId: user.id, event: 'ownership_denied', status: 'failure', metadata: { bus_id: busId } }, logger);
      throw new AppError(403, 'WRONG_BUS', 'This supervisor is not assigned to the trip bus');
    }
  }
  async function queueEvent({ parentId, studentId, tripId, status, eventType = 'ATTENDANCE_UPDATED' }) {
    return { id: idFactory(), type: eventType, status: 'PENDING', created_at: now(), parent_id: parentId, user_ids: [parentId], student_id: studentId, trip_id: tripId, attendance_status: status, message: `Student attendance updated: ${status}` };
  }
  return {
    async mark(req, res, next) { try {
      const parsed = markSchema.safeParse(req.body); if (!parsed.success) throw new AppError(400, 'INVALID_ATTENDANCE', 'Valid student, date, and attendance status are required');
      const trip = await models.trips.get({ id: req.params.id }); if (!trip) throw new AppError(404, 'TRIP_NOT_FOUND', 'Trip was not found');
      if (trip.status === 'cancelled' || trip.cancelled_date === parsed.data.date) throw new AppError(409, 'TRIP_CANCELLED', 'Attendance cannot be recorded for a cancelled trip');
      await assertSupervisorOwnsBus(req.user, trip.bus_id);
      const student = await models.students.get({ id: parsed.data.student_id }); if (!student) throw new AppError(404, 'STUDENT_NOT_FOUND', 'Student was not found');
      if (student.bus_id !== trip.bus_id) {
        await recordSafely(auditService, { userId: req.user.id, event: 'ownership_denied', status: 'failure', metadata: { trip_id: trip.id, student_id: student.id } }, logger);
        throw new AppError(403, 'WRONG_BUS', 'Student is not assigned to the trip bus');
      }
      const records = await models.attendance.findByTripId(trip.id, { limit: 100 });
      if (records.some((item) => item.student_id === student.id && item.date === parsed.data.date)) throw new AppError(409, 'ATTENDANCE_EXISTS', 'Attendance is already marked for this student and date');
      const attendance = { id: attendanceId(trip.id, parsed.data.date, student.id), ...parsed.data, trip_id: trip.id, marked_by: req.user.id, created_at: now() };
      const event = await queueEvent({ parentId: student.parent_id, studentId: student.id, tripId: trip.id, status: attendance.status, eventType: 'ATTENDANCE_MARKED' });
      try { await db.send(new TransactWriteCommand({ TransactItems: [
        { Put: { TableName: models.attendance.tableName, Item: attendance, ConditionExpression: 'attribute_not_exists(#id)', ExpressionAttributeNames: { '#id': 'id' } } },
        { Put: { TableName: models.notificationOutbox.tableName, Item: event, ConditionExpression: 'attribute_not_exists(#id)', ExpressionAttributeNames: { '#id': 'id' } } },
      ] })); } catch (error) { if (isConflict(error)) throw new AppError(409, 'ATTENDANCE_EXISTS', 'Attendance is already marked for this student and date'); throw error; }
      await notificationService?.publish(event);
      await recordSafely(auditService, { userId: req.user.id, event: 'attendance_marked', status: 'success', metadata: { student_id: student.id, trip_id: trip.id, attendance_status: attendance.status } }, logger);
      logger?.info({ event: 'attendance_updated', user_id: req.user.id, student_id: student.id, trip_id: trip.id, status: attendance.status });
      res.status(201).json(attendance);
    } catch (error) { next(error); } },
    async listForTrip(req, res, next) { try {
      const trip = await models.trips.get({ id: req.params.id }); if (!trip) throw new AppError(404, 'TRIP_NOT_FOUND', 'Trip was not found');
      const page = await models.attendance.queryPage('trip_id', trip.id, parsePage(req, 'trip_id', trip.id));
      const records = page.items;
      if (page.lastEvaluatedKey) res.set('X-Next-Cursor', Buffer.from(JSON.stringify(page.lastEvaluatedKey)).toString('base64url'));
      if (req.user.role === 'supervisor') await assertSupervisorOwnsBus(req.user, trip.bus_id);
      if (req.user.role === 'parent') {
        const children = await models.students.findByParentId(req.user.id);
        const owned = new Set(children.map((child) => child.id));
        const visible = records.filter((record) => owned.has(record.student_id));
        if (!visible.length && !page.lastEvaluatedKey) throw new AppError(404, 'ATTENDANCE_NOT_FOUND', 'Attendance was not found');
        return res.json(visible);
      }
      res.json(records);
    } catch (error) { next(error); } },
    async update(req, res, next) { try {
      const parsed = updateSchema.safeParse(req.body); if (!parsed.success) throw new AppError(400, 'INVALID_ATTENDANCE', 'A valid attendance status is required');
      const existing = await models.attendance.get({ id: req.params.id }); if (!existing) throw new AppError(404, 'ATTENDANCE_NOT_FOUND', 'Attendance was not found');
      if (req.user.role === 'supervisor') {
        const trip = await models.trips.get({ id: existing.trip_id }); if (!trip) throw new AppError(404, 'TRIP_NOT_FOUND', 'Trip was not found');
        await assertSupervisorOwnsBus(req.user, trip.bus_id);
      }
      const student = await models.students.get({ id: existing.student_id });
      const updated = { ...existing, status: parsed.data.status, corrected_by: req.user.id, updated_at: now() };
      const event = await queueEvent({ parentId: student?.parent_id, studentId: existing.student_id, tripId: existing.trip_id, status: parsed.data.status });
      await db.send(new TransactWriteCommand({ TransactItems: [
        { Update: {
          TableName: models.attendance.tableName, Key: { id: existing.id },
          UpdateExpression: 'SET #status = :status, #correctedBy = :correctedBy, #updatedAt = :updatedAt',
          ExpressionAttributeNames: { '#id': 'id', '#status': 'status', '#correctedBy': 'corrected_by', '#updatedAt': 'updated_at' },
          ExpressionAttributeValues: { ':status': parsed.data.status, ':correctedBy': req.user.id, ':updatedAt': updated.updated_at },
          ConditionExpression: 'attribute_exists(#id)',
        } },
        { Put: { TableName: models.notificationOutbox.tableName, Item: event } },
      ] }));
      await notificationService?.publish(event);
      await recordSafely(auditService, { userId: req.user.id, event: 'attendance_updated', status: 'success', metadata: { attendance_id: existing.id, trip_id: existing.trip_id, attendance_status: parsed.data.status } }, logger);
      logger?.info({ event: 'attendance_updated', user_id: req.user.id, attendance_id: existing.id, trip_id: existing.trip_id, status: parsed.data.status });
      res.json(updated);
    } catch (error) { next(error); } },
  };
}
module.exports = { createAttendanceController };
