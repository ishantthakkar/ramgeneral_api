const express = require('express');
const customerController = require('../controllers/customerController');
const { verifyToken } = require('../middleware/authMiddleware');

const router = express.Router();

router.get('/customers', verifyToken, customerController.listCustomers);
router.get('/customers-list', verifyToken, customerController.listConvertedCustomers);
router.get('/customers/assigned', verifyToken, customerController.listAssignedCustomers);
router.get('/customers/inspections', verifyToken, customerController.listInspections);
router.get('/customers/commission-list', verifyToken, customerController.customerCommissionList);
router.get('/:id', verifyToken, customerController.getCustomer);
router.put('/customers/:id', verifyToken, customerController.updateCustomer);
router.patch('/customers/:id/assign-contractor', verifyToken, customerController.assignContractor);
router.post('/customers/:id/assign', verifyToken, customerController.assignCustomer);
router.post('/:customerId/:status/update-status', verifyToken, customerController.updateCustomerSurveyStatus);
router.post('/customers/:id/materials', verifyToken, customerController.addCustomerMaterial);
router.post('/customers/:id/assign-to-contractor', verifyToken, customerController.assignToContractor);
router.post('/customers/:id/verify', verifyToken, customerController.verifyCustomer);
router.post('/customers/:id/activities', verifyToken, customerController.addCustomerActivity);
router.post('/customers/:id/commissions', verifyToken, customerController.updateCustomerCommissions);
router.get('/customers/:id/activities', verifyToken, customerController.getCustomerActivities);
module.exports = router;
