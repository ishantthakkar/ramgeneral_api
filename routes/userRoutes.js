const express = require('express');
const userController = require('../controllers/userController');
const { verifyToken } = require('../middleware/authMiddleware');

const router = express.Router();

router.post('/user-create', verifyToken, userController.createUser);
router.post('/send-otp', userController.sendUserOtp);
router.post('/verify-otp', userController.verifyUserOtp);
router.get('/user-list', verifyToken, userController.listUsers);
router.get('/user/:id', verifyToken, userController.getUser);

module.exports = router;
