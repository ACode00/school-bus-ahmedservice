const express = require('express');
const { createUsersController } = require('../controllers/users.controller');
const { requireAuth } = require('../middleware/require-auth');
const { requireRole } = require('../middleware/require-role');

function createUsersRouter(services) {
  const router = express.Router();
  const controller = createUsersController(services);
  router.post('/', requireAuth(services), requireRole(services, 'admin'), controller.register);
  return router;
}

module.exports = { createUsersRouter };
