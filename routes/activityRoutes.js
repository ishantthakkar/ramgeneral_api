const express = require('express');
const activityController = require('../controllers/activityController');
const { verifyToken } = require('../middleware/authMiddleware');

const router = express.Router();

router.get('/', verifyToken, activityController.getActivityLogs);

module.exports = router;
