const express = require('express');
const { createTripsController } = require('../controllers/trips.controller');
const { requireAuth } = require('../middleware/require-auth');
const { requireRole } = require('../middleware/require-role');

function createTripsRouter(services) {
  const router = express.Router(); const controller = createTripsController(services); const auth = requireAuth(services);
  router.get('/:id/eta', auth, controller.getEta);
  router.put('/:id/times', auth, requireRole(services, 'admin'), controller.putTimes);
  router.patch('/:id/status', auth, requireRole(services, 'admin'), controller.patchStatus);
  return router;
}
module.exports = { createTripsRouter };
