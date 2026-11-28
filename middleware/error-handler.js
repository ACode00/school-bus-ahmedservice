class AppError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
  }
}

function errorHandler(logger) {
  return (error, req, res, next) => {
    if (res.headersSent) {
      next(error);
      return;
    }

    const status = Number.isInteger(error.status) ? error.status : 500;
    const code = error.code || 'INTERNAL_ERROR';
    const message = status < 500 ? error.message : 'An unexpected error occurred';

    // Refused requests (401, 403, 429) are logged as SECURITY lines. A CloudWatch
    // metric filter counts them and an alarm fires when there are too many.
    // The token and the password are never logged.
    const security = status === 401 || status === 403 || status === 429;
    (status >= 500 ? logger.error : logger.warn)({
      event: security ? 'SECURITY' : 'error',
      ...(security ? { reason: code, method: req.method, path: req.path, user_id: req.user?.id || null } : {}),
      request_id: req.id,
      status,
      code,
      message: status >= 500 ? 'Request failed' : message,
    });

    res.status(status).json({ error: { code, message } });
  };
}

module.exports = { AppError, errorHandler };
