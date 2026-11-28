const {
  CreateLogGroupCommand,
  CreateLogStreamCommand,
  DescribeLogStreamsCommand,
  PutMetricFilterCommand,
  ResourceAlreadyExistsException,
} = require('@aws-sdk/client-cloudwatch-logs');
const { PutMetricAlarmCommand } = require('@aws-sdk/client-cloudwatch');

const METRIC_NAMESPACE = 'SchoolBusTracker/ScheduleArrival';

// Two metric filters on the backend log group, each with one alarm:
// - SECURITY lines (401, 403 and 429 answers, including blocked logins)
// - 5xx answers ("Request failed")
// The filters use plain text patterns because JSON patterns did not match on Floci.
const MONITORS = [
  { filterName: 'schedule-arrival-security-denied', pattern: 'SECURITY', metricName: 'SecurityDenied', alarmName: 'schedule-arrival-security-denied', threshold: 5, description: '5 or more refused requests (401, 403, 429) in 5 minutes' },
  { filterName: 'schedule-arrival-server-errors', pattern: '"Request failed"', metricName: 'ServerErrors', alarmName: 'schedule-arrival-server-errors', threshold: 1, description: 'Any 5xx answer in 5 minutes' },
];

async function provisionMonitoring({ cloudWatchLogs, cloudWatch }, logGroupName) {
  const filters = [];
  const alarms = [];
  for (const monitor of MONITORS) {
    await cloudWatchLogs.send(new PutMetricFilterCommand({
      logGroupName,
      filterName: monitor.filterName,
      filterPattern: monitor.pattern,
      metricTransformations: [{ metricName: monitor.metricName, metricNamespace: METRIC_NAMESPACE, metricValue: '1', defaultValue: 0 }],
    }));
    filters.push(monitor.filterName);
    if (!cloudWatch) continue;
    await cloudWatch.send(new PutMetricAlarmCommand({
      AlarmName: monitor.alarmName,
      AlarmDescription: monitor.description,
      Namespace: METRIC_NAMESPACE,
      MetricName: monitor.metricName,
      Statistic: 'Sum',
      Period: 300,
      EvaluationPeriods: 1,
      Threshold: monitor.threshold,
      ComparisonOperator: 'GreaterThanOrEqualToThreshold',
      TreatMissingData: 'notBreaching',
    }));
    alarms.push(monitor.alarmName);
  }
  return { filters, alarms };
}

async function createIfMissing(client, command, name) {
  try { await client.send(new command(name)); return 'created'; }
  catch (error) {
    if (error.name === 'ResourceAlreadyExistsException' || error instanceof ResourceAlreadyExistsException) return 'exists';
    throw error;
  }
}

async function provision({ cloudWatchLogs, cloudWatch }, config = {}) {
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
  const monitoring = await provisionMonitoring({ cloudWatchLogs, cloudWatch }, logGroupName);
  return { logGroupName, logStreamName, workerLogStreamName, group, stream, workerStream, ...monitoring };
}

module.exports = { provision, MONITORS, METRIC_NAMESPACE };
