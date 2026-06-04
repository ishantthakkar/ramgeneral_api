const express = require('express');
const customerController = require('../controllers/customerController');
const quotationController = require('../controllers/quotationController');
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

const billStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadPath = path.join(__dirname, '../uploads/leads/bills');
        fs.mkdirSync(uploadPath, { recursive: true });
        cb(null, uploadPath);
    },
    filename: (req, file, cb) => {
        const timestamp = Date.now();
        const unique = Math.round(Math.random() * 1e9);
        const safeName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
        cb(null, `${timestamp}-${unique}-${safeName}`);
    },
});

const uploadElectricityBill = multer({
    storage: billStorage,
    fileFilter: (req, file, cb) => {
        const isImage = file.mimetype && file.mimetype.startsWith('image/');
        const isPdf = file.mimetype === 'application/pdf';
        if (!isImage && !isPdf) {
            return cb(new Error('Only image or PDF files are allowed.'), false);
        }
        cb(null, true);
    },
    limits: {
        fileSize: 10 * 1024 * 1024,
        files: 20,
    },
});

const quotationUploadStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadPath = path.join(__dirname, '../uploads/quotations');
        fs.mkdirSync(uploadPath, { recursive: true });
        cb(null, uploadPath);
    },
    filename: (req, file, cb) => {
        const customerId = req.params.customerId || req.params.id || 'customer';
        const timestamp = Date.now();
        const unique = Math.round(Math.random() * 1e9);
        const safeName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
        cb(null, `${customerId}-${timestamp}-${unique}-${safeName}`);
    },
});

const uploadQuotation = multer({
    storage: quotationUploadStorage,
    fileFilter: (req, file, cb) => {
        const isImage = file.mimetype && file.mimetype.startsWith('image/');
        const isPdf = file.mimetype === 'application/pdf';
        if (!isImage && !isPdf) {
            return cb(new Error('Only PDF or image files are allowed.'), false);
        }
        cb(null, true);
    },
    limits: {
        fileSize: 10 * 1024 * 1024,
        files: 20,
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
router.get('/inspection-list-user', verifyToken, customerController.inspectionListByUser);
router.get('/quotations-list', verifyToken, quotationController.listQuotationsForManagerApproval);
router.get('/:id', verifyToken, customerController.getCustomer);
router.post('/customers/reassign-salesperson', verifyToken, customerController.reassignSalesPerson);
router.post(
    '/customers/:id',
    verifyToken,
    uploadElectricityBill.array('upload_electricity_bill', 20),
    customerController.updateCustomer
);
router.post('/customers/:id/assign-contractor', verifyToken, customerController.assignContractor);
router.post('/customers/:id/assign', verifyToken, customerController.assignCustomer);
router.post('/:customerId/:status/update-status', verifyToken, customerController.updateCustomerSurveyStatus);
router.post('/customers/:id/materials', verifyToken, upload.array('images', 10), customerController.addCustomerMaterial);
router.post('/customers/:id/assign-to-contractor', verifyToken, customerController.assignToContractor);
router.post('/customers/:id/verify', verifyToken, customerController.verifyCustomer);
router.post('/:id/activities', verifyToken, customerController.addCustomerActivity);
router.post('/:customerId/quotation', verifyToken, quotationController.createQuotation);
router.post('/customers/:customerId/quotation', verifyToken, quotationController.createQuotation);
router.post(
    '/:customerId/quotation/upload',
    verifyToken,
    uploadQuotation.array('quotations', 20),
    quotationController.uploadQuotation
);
router.post(
    '/customers/:customerId/quotation/upload',
    verifyToken,
    uploadQuotation.array('quotations', 20),
    quotationController.uploadQuotation
);
router.get('/customers/:customerId/quotations', verifyToken, quotationController.listCustomerQuotations);
router.get('/:customerId/quotations', verifyToken, quotationController.listCustomerQuotations);
router.post(
    '/customers/:customerId/quotation/approve',
    verifyToken,
    quotationController.approveQuotation
);
router.post(
    '/:customerId/quotation/approve',
    verifyToken,
    quotationController.approveQuotation
);
router.post('/customers/:id/commissions', verifyToken, customerController.updateCustomerCommissions);
router.get('/customers/:id/activities', verifyToken, customerController.getCustomerActivities);
router.post('/:id/edit-status', verifyToken, customerController.editCustomerStatus);
router.post('/:id/admin-approval', verifyToken, customerController.adminApprovalStatus);
router.post('/:id/material-status', verifyToken, customerController.confirmMaterialStatus);
router.post('/:id/installation-status', verifyToken, customerController.updateInstallationStatus);
router.post('/:id/installation-notes', verifyToken, customerController.addInstallationNote);
router.post('/:id/inspection-notes', verifyToken, customerController.addInspectionNote);
router.post('/:id/inspection-status', verifyToken, customerController.updateInspectionStatus);
module.exports = router;
