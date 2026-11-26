const { AppError } = require('../middleware/error-handler');

async function requireStudentOnBus(models, studentId, busId) {
  const student = await models.students.get({ id: studentId });
  if (!student) throw new AppError(404, 'STUDENT_NOT_FOUND', 'Student was not found');
  if (student.bus_id !== busId) throw new AppError(403, 'WRONG_BUS', 'Student is not assigned to this bus');
  return student;
}

module.exports = { requireStudentOnBus };
