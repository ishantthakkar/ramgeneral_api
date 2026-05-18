const express = require('express');
const router = express.Router();
const serviceController = require('../controllers/serviceController');
const { verifyToken } = require('../middleware/authMiddleware');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Configure multer for material images
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadPath = path.join(__dirname, '../uploads/materials');
        if (!fs.existsSync(uploadPath)) {
            fs.mkdirSync(uploadPath, { recursive: true });
        }
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

// Get eligible customers for new service ticket
router.get('/customers/eligible', verifyToken, serviceController.getEligibleCustomers);

// Get specific customer details and their surveys
router.get('/customers/:id/details', verifyToken, serviceController.getCustomerDetailsForService);

// Service ticket routes
router.post('/', verifyToken, upload.array('images', 10), serviceController.createService);
router.get('/', verifyToken, serviceController.getAllServices);
router.get('/:id', verifyToken, serviceController.getServiceById);
router.put('/:id', verifyToken, upload.array('images', 10), serviceController.updateService);
router.put('/:id/material', verifyToken, upload.array('images', 10), serviceController.addServiceMaterial);
router.put('/:id/assign', verifyToken, serviceController.assignContractorToService);

module.exports = router;

