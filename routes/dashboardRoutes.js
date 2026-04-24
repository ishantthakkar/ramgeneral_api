const express = require('express');
const dashboardController = require('../controllers/dashboardController');
const { verifyToken } = require('../middleware/authMiddleware');

const router = express.Router();

router.get('/stats', verifyToken, dashboardController.getAdminDashboardStats);

module.exports = router;
