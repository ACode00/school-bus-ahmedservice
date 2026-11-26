const express = require('express');
const { createHolidaysController } = require('../controllers/holidays.controller');
const { requireAuth } = require('../middleware/require-auth');
const { requireRole } = require('../middleware/require-role');
function createHolidaysRouter(services) { const r = express.Router(); const c = createHolidaysController(services); const auth = requireAuth(services); const admin = requireRole(services, 'admin'); r.get('/', auth, c.list); r.post('/', auth, admin, c.create); r.patch('/:id', auth, admin, c.update); r.delete('/:id', auth, admin, c.remove); return r; }
module.exports = { createHolidaysRouter };
