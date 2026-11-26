function requestLogger(logger) {
  return (req, res, next) => {
    const startedAt = process.hrtime.bigint();
    const requestId = req.id;

    logger.info({
      event: 'request',
      request_id: requestId,
      method: req.method,
      path: req.path,
    });

    res.on('finish', () => {
      const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
      const event = {
        event: 'response',
        request_id: requestId,
        method: req.method,
        path: req.path,
        status: res.statusCode,
        duration_ms: Math.round(elapsedMs * 100) / 100,
      };
      (res.statusCode >= 500 ? logger.error : logger.info)(event);
    });

    next();
  };
}

module.exports = { requestLogger };
