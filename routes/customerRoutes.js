const express = require('express');
const customerController = require('../controllers/customerController');
const { verifyToken } = require('../middleware/authMiddleware');

const router = express.Router();

router.get('/customers', verifyToken, customerController.listCustomers);
router.get('/customers-list', verifyToken, customerController.listConvertedCustomers);
router.get('/customers/:id', verifyToken, customerController.getCustomer);
router.put('/customers/:id', verifyToken, customerController.updateCustomer);
router.patch('/customers/:id/assign-contractor', verifyToken, customerController.assignContractor);

module.exports = router;
