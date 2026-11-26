const { createEntityModel } = require('./entity-model');
const { TABLE_NAMES } = require('../config/table-names');
module.exports = ({ client }) => createEntityModel({ client, tableName: TABLE_NAMES.buses, indexes: { route_id: 'route-id-index', supervisor_id: 'supervisor-id-index' }, lookups: { findByRouteId: 'route_id', findBySupervisorId: 'supervisor_id' } });
