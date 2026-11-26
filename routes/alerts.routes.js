const express = require('express');
const { createAlertsController } = require('../controllers/alerts.controller');
const { requireAuth } = require('../middleware/require-auth');
const { requireRole } = require('../middleware/require-role');
function createAlertsRouter(services) { const r = express.Router(); const c = createAlertsController(services); const auth = requireAuth(services); const parent = requireRole(services, 'parent'); r.get('/', auth, parent, c.list); r.get('/current', auth, parent, c.list); r.patch('/:id/read', auth, parent, c.markRead); return r; }
module.exports = { createAlertsRouter };
