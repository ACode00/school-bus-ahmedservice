const express = require('express');
const { createUsersController } = require('../controllers/users.controller');

function createUsersRouter(services) {
  const router = express.Router();
  const controller = createUsersController(services);
  router.post('/', controller.register);
  return router;
}

module.exports = { createUsersRouter };
