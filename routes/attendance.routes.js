const express = require('express');
const { createAttendanceController } = require('../controllers/attendance.controller');
const { requireAuth } = require('../middleware/require-auth');
const { requireRole } = require('../middleware/require-role');
function createTripAttendanceRouter(services) { const router = express.Router(); const c = createAttendanceController(services); const auth = requireAuth(services); router.post('/:id/attendance', auth, requireRole(services, 'supervisor'), c.mark); router.get('/:id/attendance', auth, requireRole(services, 'admin', 'supervisor', 'parent'), c.listForTrip); return router; }
function createAttendanceRouter(services) { const router = express.Router(); router.patch('/:id', requireAuth(services), requireRole(services, 'admin', 'supervisor'), createAttendanceController(services).update); return router; }
module.exports = { createTripAttendanceRouter, createAttendanceRouter };
