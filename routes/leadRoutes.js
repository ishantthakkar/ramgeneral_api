const express = require('express');
const leadController = require('../controllers/leadController');
const { verifyToken } = require('../middleware/authMiddleware');

const router = express.Router();

const multer = require('multer');
const path = require('path');
const fs = require('fs');

const storage = multer.diskStorage({
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
  storage,
  fileFilter: (req, file, cb) => {
    const isImage = file.mimetype && file.mimetype.startsWith('image/');
    const isPdf = file.mimetype === 'application/pdf';
    if (!isImage && !isPdf) {
      return cb(new Error('Only image or PDF files are allowed.'), false);
    }
    cb(null, true);
  },
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB per file
    files: 20,
  },
});

router.get('/lead-sources', verifyToken, leadController.getLeadSources);
router.get('/leads/sales-persons', verifyToken, leadController.listSalesPersons);
router.get('/leads', verifyToken, leadController.listLeads);
router.get('/leads/:id', verifyToken, leadController.getLead);
router.post(
  '/leads-create',
  verifyToken,
  uploadElectricityBill.array('upload_electricity_bill', 20),
  leadController.createLead
);
router.post('/leads/:id/assign', verifyToken, leadController.assignLeadToSalesPerson);
router.post('/leads/:id/lost', verifyToken, leadController.markLeadAsLost);
router.post('/leads/:id/convert', verifyToken, leadController.convertToCustomer);
router.post('/leads/:id/status', verifyToken, leadController.updateLeadStatus);
router.post('/leads/update-status', verifyToken, leadController.updateLeadStatusById);
router.get('/leads-user', verifyToken, leadController.getLeadsByUser);

module.exports = router;
