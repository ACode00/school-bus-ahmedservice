const { createEntityModel } = require('./entity-model');
const { TABLE_NAMES } = require('../config/table-names');
module.exports = ({ client }) => createEntityModel({ client, tableName: TABLE_NAMES.users, indexes: { email: 'email-index' }, lookups: { findByEmail: 'email' } });
