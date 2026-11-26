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

    (status >= 500 ? logger.error : logger.warn)({
      event: status === 401 || status === 403 ? 'auth_failure' : 'error',
      request_id: req.id,
      status,
      code,
      message: status >= 500 ? 'Request failed' : message,
    });

    res.status(status).json({ error: { code, message } });
  };
}

module.exports = { AppError, errorHandler };
