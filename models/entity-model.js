const { BaseModel } = require('./base-model');

function createEntityModel({ client, tableName, partitionKey = 'id', sortKey, indexes = {}, lookups = {} }) {
  const model = new BaseModel({ client, tableName, partitionKey, sortKey, indexes });
  for (const [methodName, attribute] of Object.entries(lookups)) {
    model[methodName] = (value, options) => model.queryBy(attribute, value, options);
  }
  return model;
}

module.exports = { createEntityModel };
