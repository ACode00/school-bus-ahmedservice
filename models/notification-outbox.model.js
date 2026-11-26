const { createEntityModel } = require('./entity-model');
const { TABLE_NAMES } = require('../config/table-names');
module.exports = ({ client }) => createEntityModel({
  client,
  tableName: TABLE_NAMES.notificationOutbox,
  indexes: { status: { name: 'status-created-at-index', sortKey: 'created_at' } },
  lookups: { findPending: 'status' },
});
