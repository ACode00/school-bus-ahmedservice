const { createEntityModel } = require('./entity-model');
const { TABLE_NAMES } = require('../config/table-names');
module.exports = ({ client }) => createEntityModel({ client, tableName: TABLE_NAMES.routes, indexes: { name: 'name-index', area: 'area-index' }, lookups: { findByName: 'name', findByArea: 'area' } });
