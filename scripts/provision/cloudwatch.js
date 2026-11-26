const {
  CreateLogGroupCommand,
  CreateLogStreamCommand,
  DescribeLogStreamsCommand,
  ResourceAlreadyExistsException,
} = require('@aws-sdk/client-cloudwatch-logs');

async function createIfMissing(client, command, name) {
  try { await client.send(new command(name)); return 'created'; }
  catch (error) {
    if (error.name === 'ResourceAlreadyExistsException' || error instanceof ResourceAlreadyExistsException) return 'exists';
    throw error;
  }
}

async function provision({ cloudWatchLogs }, config = {}) {
  const logGroupName = config.logGroupName || process.env.CLOUDWATCH_LOG_GROUP || '/school-bus-tracker/backend';
  const logStreamName = config.logStreamName || process.env.CLOUDWATCH_LOG_STREAM || 'audit';
  const workerLogStreamName = config.workerLogStreamName || 'worker';
  const group = await createIfMissing(cloudWatchLogs, CreateLogGroupCommand, { logGroupName });
  const ensureStream = async (name) => {
    const streams = await cloudWatchLogs.send(new DescribeLogStreamsCommand({ logGroupName, logStreamNamePrefix: name }));
    if (streams.logStreams?.some((item) => item.logStreamName === name)) return 'exists';
    return createIfMissing(cloudWatchLogs, CreateLogStreamCommand, { logGroupName, logStreamName: name });
  };
  const stream = await ensureStream(logStreamName);
  const workerStream = await ensureStream(workerLogStreamName);
  return { logGroupName, logStreamName, workerLogStreamName, group, stream, workerStream };
}

module.exports = { provision };
