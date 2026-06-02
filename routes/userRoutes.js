const express = require('express');
const userController = require('../controllers/userController');
const { verifyToken } = require('../middleware/authMiddleware');

const router = express.Router();

router.post('/user-create', verifyToken, userController.createUser);
router.post('/send-otp', userController.sendUserOtp);
router.post('/verify-otp', userController.verifyUserOtp);
router.get('/user-list', verifyToken, userController.listUsers);
router.get('/contractors', verifyToken, userController.listContractors);
router.get('/sales-persons', verifyToken, userController.listSalesPersons);
router.get('/profile', verifyToken, userController.getProfile);
router.get('/working-hours', verifyToken, userController.getUserWorkingHours);
router.get('/:id([0-9a-fA-F]{24})', verifyToken, userController.getUser);

module.exports = router;
