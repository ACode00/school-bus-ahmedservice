const { createEntityModel } = require('./entity-model');
const { TABLE_NAMES } = require('../config/table-names');
module.exports = ({ client }) => createEntityModel({ client, tableName: TABLE_NAMES.stops, indexes: { route_id: 'route-id-index' }, lookups: { findByRouteId: 'route_id' } });
