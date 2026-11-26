const { createEntityModel } = require('./entity-model');
const { TABLE_NAMES } = require('../config/table-names');
module.exports = ({ client }) => createEntityModel({ client, tableName: TABLE_NAMES.attendance, indexes: { student_id: 'student-id-index', trip_id: 'trip-id-index' }, lookups: { findByStudentId: 'student_id', findByTripId: 'trip_id' } });
