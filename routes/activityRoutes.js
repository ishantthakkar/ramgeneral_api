const express = require('express');
const router = express.Router();
const activityController = require('../controllers/activityController');
const { verifyToken } = require('../middleware/authMiddleware');

// Get all activity logs
router.get('/', verifyToken, activityController.getActivityLogs);

module.exports = router;
