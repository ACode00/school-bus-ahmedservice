const { BaseModel } = require('./base-model');
const { TABLE_NAMES } = require('../config/table-names');
module.exports = ({ client }) => new BaseModel({ client, tableName: TABLE_NAMES.userEmails, partitionKey: 'email' });
