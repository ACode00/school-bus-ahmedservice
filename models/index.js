const createUsersModel = require('./users.model');
const createRoutesModel = require('./routes.model');
const createStopsModel = require('./stops.model');
const createBusesModel = require('./buses.model');
const createTripsModel = require('./trips.model');
const createTripStopsModel = require('./trip-stops.model');
const createStudentsModel = require('./students.model');
const createAttendanceModel = require('./attendance.model');
const createFavoritesModel = require('./favorites.model');
const createAlertsModel = require('./alerts.model');
const createHolidaysModel = require('./holidays.model');
const createAuditLogsModel = require('./audit-logs.model');
const createIdentityClaimsModel = require('./identity-claims.model');
const createNotificationOutboxModel = require('./notification-outbox.model');

function createModels({ client }) {
  const context = { client };
  return {
    users: createUsersModel(context),
    routes: createRoutesModel(context),
    stops: createStopsModel(context),
    buses: createBusesModel(context),
    trips: createTripsModel(context),
    tripStops: createTripStopsModel(context),
    students: createStudentsModel(context),
    attendance: createAttendanceModel(context),
    favorites: createFavoritesModel(context),
    alerts: createAlertsModel(context),
    holidays: createHolidaysModel(context),
    auditLogs: createAuditLogsModel(context),
    identityClaims: createIdentityClaimsModel(context),
    notificationOutbox: createNotificationOutboxModel(context),
  };
}

module.exports = { createModels };
