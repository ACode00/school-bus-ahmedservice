const { createEntityModel } = require('./entity-model');
const { TABLE_NAMES } = require('../config/table-names');
module.exports = ({ client }) => createEntityModel({ client, tableName: TABLE_NAMES.auditLogs, indexes: { user_id: 'user-id-index' }, lookups: { findByUserId: 'user_id' } });
