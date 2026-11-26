const cors = require('cors');
const express = require('express');
const helmet = require('helmet');
const { loadConfig } = require('./config/env');
const { createLogger } = require('./config/logger');
const { errorHandler, AppError } = require('./middleware/error-handler');
const { requestLogger } = require('./middleware/request-logger');
const healthRoutes = require('./routes/health.routes');
const { createUsersRouter } = require('./routes/users.routes');
const { createSessionsRouter } = require('./routes/sessions.routes');
const { createRoutesRouter } = require('./routes/routes.routes');
const { createStudentsRouter } = require('./routes/students.routes');
const { createTripsRouter } = require('./routes/trips.routes');
const { createStopsRouter } = require('./routes/stops.routes');
const { createTripAttendanceRouter, createAttendanceRouter } = require('./routes/attendance.routes');
const { createHolidaysRouter } = require('./routes/holidays.routes');
const { createAlertsRouter } = require('./routes/alerts.routes');

function createApp({ services = {}, config = loadConfig(process.env) } = {}) {
  const app = express();
  const logger = services.logger || createLogger();

  app.disable('x-powered-by');
  app.use((req, res, next) => {
    req.id = require('node:crypto').randomUUID();
    next();
  });
  app.use(requestLogger(logger));
  app.use(helmet());
  app.use(cors({
    origin(origin, callback) {
      if (!origin || config.corsOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(new AppError(403, 'CORS_ORIGIN_DENIED', 'Origin is not allowed'));
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'X-Request-Id', 'X-Amz-Date', 'X-Amz-Security-Token', 'X-Amz-Content-Sha256'],
    exposedHeaders: ['X-Cache', 'X-Next-Cursor', 'X-Request-Id'],
    maxAge: 600,
  }));
  app.use(express.json({ limit: '100kb' }));

  app.use(healthRoutes);

  if (services.db && services.models) {
    app.use('/api/users', createUsersRouter({ ...services, logger }));
    app.use('/api/sessions', createSessionsRouter({ ...services, logger }));
    app.use('/api/routes', createRoutesRouter({ ...services, logger }));
    app.use('/api/stops', createStopsRouter({ ...services, logger }));
    app.use('/api/students', createStudentsRouter({ ...services, logger }));
    app.use('/api/trips', createTripsRouter({ ...services, logger }));
    app.use('/api/trips', createTripAttendanceRouter({ ...services, logger }));
    app.use('/api/attendance', createAttendanceRouter({ ...services, logger }));
    app.use('/api/holidays', createHolidaysRouter({ ...services, logger }));
    app.use('/api/alerts', createAlertsRouter({ ...services, logger }));
  }

  app.use((req, res, next) => {
    next(new AppError(404, 'NOT_FOUND', 'Route not found'));
  });
  app.use(errorHandler(logger));

  return app;
}

module.exports = { createApp };
