const { createEntityModel } = require('./entity-model');
const { TABLE_NAMES } = require('../config/table-names');
module.exports = ({ client }) => {
  const model = createEntityModel({ client, tableName: TABLE_NAMES.students, indexes: { parent_id: 'parent-id-index', bus_id: 'bus-id-index' }, lookups: { findByParentId: 'parent_id', findByBusId: 'bus_id' } });
  model.findByStopId = (id, options) => model.scanBy('stop_id', id, options);
  return model;
};
