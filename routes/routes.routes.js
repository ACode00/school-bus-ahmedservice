const express = require('express');
const { createRoutesController } = require('../controllers/routes.controller');
const { requireAuth } = require('../middleware/require-auth');
const { requireRole } = require('../middleware/require-role');
function createRoutesRouter(services) {
  const router = express.Router(); const c = createRoutesController(services); const auth = requireAuth(services); const admin = requireRole(services, 'admin');
  router.get('/', auth, c.list); router.get('/:id', auth, c.get); router.get('/:id/stops', auth, c.stops); router.get('/stops/:id', auth, c.getStop);
  router.post('/', auth, admin, c.create); router.patch('/:id', auth, admin, c.update); router.delete('/:id', auth, admin, c.remove);
  router.post('/:id/stops', auth, admin, c.createStop); router.patch('/:id/stops/:stopId', auth, admin, c.updateStop); router.delete('/:id/stops/:stopId', auth, admin, c.removeStop);
  return router;
}
module.exports = { createRoutesRouter };
