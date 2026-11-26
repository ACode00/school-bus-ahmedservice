const { createEntityModel } = require('./entity-model');
const { TABLE_NAMES } = require('../config/table-names');
module.exports = ({ client }) => createEntityModel({ client, tableName: TABLE_NAMES.holidays, indexes: { date: 'date-index', year: 'year-index' }, lookups: { findByDate: 'date', findByYear: 'year' } });
