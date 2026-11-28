const ROLE_ROUTE_PATTERNS = Object.freeze({
  BusTrackerParents: ['GET/api/routes', 'GET/api/routes/*', 'GET/api/stops/*', 'GET/api/trips/*/eta', 'GET/api/trips/*/attendance'],
  BusTrackerCoordinators: ['GET/api/routes', 'GET/api/routes/*', 'GET/api/stops/*', 'GET/api/trips/*/eta', 'POST/api/trips/*/attendance', 'GET/api/trips/*/attendance', 'PATCH/api/attendance/*'],
  BusTrackerAdmins: ['*/api/*'],
});
const API_METHODS = Object.freeze([
  { method: 'GET', path: '/health', public: true },
  { method: 'POST', path: '/api/users', permission: 'POST/api/users' },
  { method: 'POST', path: '/api/sessions', permission: 'POST/api/sessions' },
  { method: 'DELETE', path: '/api/sessions/current', permission: 'DELETE/api/sessions/current' },
  { method: 'GET', path: '/api/routes', permission: 'GET/api/routes' },
  { method: 'GET', path: '/api/routes/{id}', permission: 'GET/api/routes/*' },
  { method: 'GET', path: '/api/routes/{id}/stops', permission: 'GET/api/routes/*' },
  { method: 'GET', path: '/api/routes/stops/{id}', permission: 'GET/api/routes/*' },
  { method: 'GET', path: '/api/stops/{id}', permission: 'GET/api/stops/*' },
  { method: 'POST', path: '/api/routes', permission: 'POST/api/routes' },
  { method: 'PATCH', path: '/api/routes/{id}', permission: 'PATCH/api/routes/*' },
  { method: 'DELETE', path: '/api/routes/{id}', permission: 'DELETE/api/routes/*' },
  { method: 'POST', path: '/api/routes/{id}/stops', permission: 'POST/api/routes/*/stops' },
  { method: 'PATCH', path: '/api/routes/{id}/stops/{stopId}', permission: 'PATCH/api/routes/*/stops/*' },
  { method: 'DELETE', path: '/api/routes/{id}/stops/{stopId}', permission: 'DELETE/api/routes/*/stops/*' },
  { method: 'POST', path: '/api/students', permission: 'POST/api/students' },
  { method: 'GET', path: '/api/trips/{id}/eta', permission: 'GET/api/trips/*/eta' },
  { method: 'PUT', path: '/api/trips/{id}/times', permission: 'PUT/api/trips/*/times' },
  { method: 'PATCH', path: '/api/trips/{id}/status', permission: 'PATCH/api/trips/*/status' },
  { method: 'POST', path: '/api/trips/{id}/attendance', permission: 'POST/api/trips/*/attendance' },
  { method: 'GET', path: '/api/trips/{id}/attendance', permission: 'GET/api/trips/*/attendance' },
  { method: 'PATCH', path: '/api/attendance/{id}', permission: 'PATCH/api/attendance/*' },
]);

module.exports = { API_METHODS, ROLE_ROUTE_PATTERNS };
