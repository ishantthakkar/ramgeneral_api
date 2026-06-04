const express = require('express');
const usaStatesController = require('../controllers/usaStatesController');
const { verifyToken } = require('../middleware/authMiddleware');

const router = express.Router();

router.get('/', verifyToken, usaStatesController.getUsaStates);

module.exports = router;
