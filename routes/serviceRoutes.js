const express = require('express');
const router = express.Router();
const serviceController = require('../controllers/serviceController');
const { verifyToken } = require('../middleware/authMiddleware');

// Get eligible customers for new service ticket
router.get('/customers/eligible', verifyToken, serviceController.getEligibleCustomers);

// Get specific customer details and their surveys
router.get('/customers/:id/details', verifyToken, serviceController.getCustomerDetailsForService);

// Service ticket routes
router.post('/', verifyToken, serviceController.createService);
router.get('/', verifyToken, serviceController.getAllServices);
router.get('/:id', verifyToken, serviceController.getServiceById);
router.put('/:id', verifyToken, serviceController.updateService);
router.put('/:id/material', verifyToken, serviceController.addServiceMaterial);
router.put('/:id/assign', verifyToken, serviceController.assignContractorToService);

module.exports = router;
