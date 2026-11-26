const express = require('express');
const { createSessionsController } = require('../controllers/sessions.controller');
const { requireAuth } = require('../middleware/require-auth');

function createSessionsRouter(services) {
  const router = express.Router();
  const controller = createSessionsController(services);
  router.post('/', controller.create);
  router.delete('/current', requireAuth(services), controller.remove);
  return router;
}

module.exports = { createSessionsRouter };
