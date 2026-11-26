const { createEntityModel } = require('./entity-model');
const { TABLE_NAMES } = require('../config/table-names');
module.exports = ({ client }) => createEntityModel({ client, tableName: TABLE_NAMES.sessions, indexes: { token_hash: 'token-hash-index' }, lookups: { findByTokenHash: 'token_hash' } });
