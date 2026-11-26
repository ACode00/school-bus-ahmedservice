const TABLE_NAMES = Object.freeze({
  users: 'Users',
  sessions: 'Sessions',
  userEmails: 'UserEmails',
  routes: 'Routes',
  stops: 'Stops',
  buses: 'Buses',
  trips: 'Trips',
  tripStops: 'TripStops',
  students: 'Students',
  attendance: 'Attendance',
  favorites: 'Favorites',
  alerts: 'Alerts',
  holidays: 'Holidays',
  auditLogs: 'AuditLogs',
  identityClaims: 'IdentityClaims',
  notificationOutbox: 'NotificationOutbox',
});

module.exports = { TABLE_NAMES };
