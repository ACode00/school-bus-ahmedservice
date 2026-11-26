const express = require('express');
const { createStudentsController } = require('../controllers/students.controller');
const { requireAuth } = require('../middleware/require-auth');
const { requireRole } = require('../middleware/require-role');
function createStudentsRouter(services) { const router = express.Router(); router.post('/', requireAuth(services), requireRole(services, 'admin'), createStudentsController(services).create); return router; }
module.exports = { createStudentsRouter };
