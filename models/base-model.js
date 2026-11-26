const {
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  ScanCommand,
  UpdateCommand,
} = require('@aws-sdk/lib-dynamodb');

class BaseModel {
  constructor({ client, tableName, partitionKey = 'id', sortKey, indexes = {} }) {
    if (!client || !tableName) throw new Error('client and tableName are required');
    this.client = client;
    this.tableName = tableName;
    this.partitionKey = partitionKey;
    this.sortKey = sortKey;
    this.indexes = Object.freeze({ ...indexes });
  }

  async get(key) {
    const result = await this.client.send(new GetCommand({ TableName: this.tableName, Key: key }));
    return result.Item || null;
  }

  async create(item) {
    if (item[this.partitionKey] === undefined || (this.sortKey && item[this.sortKey] === undefined)) {
      throw new Error(`Item must include ${this.partitionKey}${this.sortKey ? ` and ${this.sortKey}` : ''}`);
    }
    const names = { '#pk': this.partitionKey };
    let condition = 'attribute_not_exists(#pk)';
    if (this.sortKey) {
      names['#sk'] = this.sortKey;
      condition += ' AND attribute_not_exists(#sk)';
    }
    await this.client.send(new PutCommand({
      TableName: this.tableName,
      Item: item,
      ConditionExpression: condition,
      ExpressionAttributeNames: names,
    }));
    return item;
  }

  async update(key, changes) {
    const entries = Object.entries(changes || {}).filter(([field, value]) =>
      field !== this.partitionKey && field !== this.sortKey && value !== undefined);
    if (!entries.length) throw new Error('At least one non-key field is required');

    const names = { '#keyPk': this.partitionKey };
    const values = {};
    const assignments = entries.map(([field, value], index) => {
      const name = `#field${index}`;
      const placeholder = `:value${index}`;
      names[name] = field;
      values[placeholder] = value;
      return `${name} = ${placeholder}`;
    });
    const result = await this.client.send(new UpdateCommand({
      TableName: this.tableName,
      Key: key,
      UpdateExpression: `SET ${assignments.join(', ')}`,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
      ConditionExpression: 'attribute_exists(#keyPk)',
      ReturnValues: 'ALL_NEW',
    }));
    return result.Attributes || null;
  }

  async delete(key) {
    const result = await this.client.send(new DeleteCommand({
      TableName: this.tableName,
      Key: key,
      ReturnValues: 'ALL_OLD',
    }));
    return result.Attributes || null;
  }

  _queryInput(attribute, value, options = {}) {
    const index = this.indexes[attribute];
    if (!index) throw new Error(`No index configured for ${attribute}`);
    const indexConfig = typeof index === 'string' ? { name: index } : index;
    const names = { '#lookup': attribute };
    const values = { ':lookup': value };
    let keyCondition = '#lookup = :lookup';

    if (options.sortKey) {
      if (indexConfig.sortKey !== options.sortKey.attribute) {
        throw new Error(`No sort key configured for ${attribute} index`);
      }
      const operator = options.sortKey.operator || '>=';
      if (!new Set(['=', '<', '<=', '>', '>=', 'begins_with']).has(operator)) {
        throw new Error('Unsupported sort key operator');
      }
      names['#sort'] = indexConfig.sortKey;
      values[':sort'] = options.sortKey.value;
      keyCondition += operator === 'begins_with'
        ? ' AND begins_with(#sort, :sort)'
        : ` AND #sort ${operator} :sort`;
    }

    return {
      TableName: this.tableName,
      IndexName: indexConfig.name,
      KeyConditionExpression: keyCondition,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
      ...(options.limit ? { Limit: options.limit } : {}),
      ...(options.exclusiveStartKey ? { ExclusiveStartKey: options.exclusiveStartKey } : {}),
      ...(options.scanIndexForward === undefined ? {} : { ScanIndexForward: options.scanIndexForward }),
    };
  }

  async queryBy(attribute, value, options = {}) {
    const items = [];
    let exclusiveStartKey = options.exclusiveStartKey;
    do {
      const result = await this.client.send(new QueryCommand(this._queryInput(attribute, value, { ...options, ...(exclusiveStartKey ? { exclusiveStartKey } : {}) })));
      items.push(...(result.Items || []));
      if (options.limit) break;
      exclusiveStartKey = result.LastEvaluatedKey;
    } while (exclusiveStartKey);
    return items;
  }

  async queryPage(attribute, value, options = {}) {
    const result = await this.client.send(new QueryCommand(this._queryInput(attribute, value, options)));
    return { items: result.Items || [], lastEvaluatedKey: result.LastEvaluatedKey || null };
  }

  async queryPartition(value, options = {}) {
    const items = [];
    let exclusiveStartKey;
    do {
      const result = await this.client.send(new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: '#partition = :partition',
        ExpressionAttributeNames: { '#partition': this.partitionKey },
        ExpressionAttributeValues: { ':partition': value },
        ...(options.limit ? { Limit: options.limit } : {}),
        ...(exclusiveStartKey ? { ExclusiveStartKey: exclusiveStartKey } : {}),
        ...(options.scanIndexForward === undefined ? {} : { ScanIndexForward: options.scanIndexForward }),
      }));
      items.push(...(result.Items || []));
      if (options.limit) break;
      exclusiveStartKey = result.LastEvaluatedKey;
    } while (exclusiveStartKey);
    return items;
  }

  async list({ limit = 100 } = {}) {
    const result = await this.client.send(new ScanCommand({ TableName: this.tableName, Limit: Math.min(Math.max(limit, 1), 100) }));
    return result.Items || [];
  }

  async scanBy(attribute, value, { limit = 100 } = {}) {
    const items = [];
    let exclusiveStartKey;
    do {
      const result = await this.client.send(new ScanCommand({
        TableName: this.tableName,
        FilterExpression: '#field = :value',
        ExpressionAttributeNames: { '#field': attribute },
        ExpressionAttributeValues: { ':value': value },
        Limit: Math.min(Math.max(limit, 1), 100),
        ...(exclusiveStartKey ? { ExclusiveStartKey: exclusiveStartKey } : {}),
      }));
      items.push(...(result.Items || [])); exclusiveStartKey = result.LastEvaluatedKey;
    } while (exclusiveStartKey);
    return items;
  }
}

module.exports = { BaseModel };
