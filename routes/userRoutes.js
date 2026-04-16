const express = require('express');
const userController = require('../controllers/userController');
const { verifyToken } = require('../middleware/authMiddleware');

const router = express.Router();

router.post('/user-create', verifyToken, userController.createUser);
router.get('/user-list', verifyToken, userController.listUsers);

module.exports = router;
