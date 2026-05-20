const express = require('express');
const customerController = require('../controllers/customerController');
const { verifyToken } = require('../middleware/authMiddleware');

const router = express.Router();

const multer = require('multer');
const path = require('path');
const fs = require('fs');

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadPath = path.join(__dirname, '../uploads/materials');
        fs.mkdirSync(uploadPath, { recursive: true });
        cb(null, uploadPath);
    },
    filename: (req, file, cb) => {
        const timestamp = Date.now();
        const safeName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
        cb(null, `${timestamp}-${safeName}`);
    },
});

const upload = multer({
    storage,
    fileFilter: (req, file, cb) => {
        if (!file.mimetype.startsWith('image/')) {
            return cb(new Error('Only image files are allowed.'), false);
        }
        cb(null, true);
    },
    limits: {
        fileSize: 10 * 1024 * 1024, // 10MB
    },
});

router.get('/customers', verifyToken, customerController.listCustomers);
router.get('/customers-list', verifyToken, customerController.listConvertedCustomers);
router.get('/customers-user', verifyToken, customerController.getCustomersByUser);
router.get('/customers-contractor', verifyToken, customerController.getCustomersByContractor);
router.get('/customers-pm', verifyToken, customerController.getCustomersByPM);
router.get('/customers/assigned', verifyToken, customerController.listAssignedCustomers);
router.get('/customers/inspections', verifyToken, customerController.listInspections);
router.get('/customers/commission-list', verifyToken, customerController.customerCommissionList);
router.get('/installation-list', verifyToken, customerController.installationListByUser);
router.get('/:id', verifyToken, customerController.getCustomer);
router.post('/customers/:id', verifyToken, customerController.updateCustomer);
router.post('/customers/:id/assign-contractor', verifyToken, customerController.assignContractor);
router.post('/customers/:id/assign', verifyToken, customerController.assignCustomer);
router.post('/:customerId/:status/update-status', verifyToken, customerController.updateCustomerSurveyStatus);
router.post('/customers/:id/materials', verifyToken, upload.array('images', 10), customerController.addCustomerMaterial);
router.post('/customers/:id/assign-to-contractor', verifyToken, customerController.assignToContractor);
router.post('/customers/:id/verify', verifyToken, customerController.verifyCustomer);
router.post('/customers/:id/activities', verifyToken, customerController.addCustomerActivity);
router.post('/customers/:id/commissions', verifyToken, customerController.updateCustomerCommissions);
router.get('/customers/:id/activities', verifyToken, customerController.getCustomerActivities);
router.post('/:id/edit-status', verifyToken, customerController.editCustomerStatus);
router.post('/:id/admin-approval', verifyToken, customerController.adminApprovalStatus);
router.post('/:id/material-status', verifyToken, customerController.confirmMaterialStatus);
router.post('/:id/installation-status', verifyToken, customerController.updateInstallationStatus);
router.post('/:id/installation-notes', verifyToken, customerController.addInstallationNote);
module.exports = router;
