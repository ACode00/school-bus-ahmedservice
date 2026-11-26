const express = require('express');
const { createRoutesController } = require('../controllers/routes.controller');
const { requireAuth } = require('../middleware/require-auth');
function createStopsRouter(services) { const router = express.Router(); router.get('/:id', requireAuth(services), createRoutesController(services).getStop); return router; }
module.exports = { createStopsRouter };
