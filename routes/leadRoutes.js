const express = require('express');
const leadController = require('../controllers/leadController');
const { verifyToken } = require('../middleware/authMiddleware');

const router = express.Router();

const multer = require('multer');
const path = require('path');
const fs = require('fs');

const isContactBusinessCardField = (fieldname) =>
  /^contact_(?:business_card|bussiness_card)_\d+$/i.test(fieldname) ||
  /^contact_\d+_(?:business_card|bussiness_card)$/i.test(fieldname);

const leadUploadStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const subdir = isContactBusinessCardField(file.fieldname) ? 'business-cards' : 'bills';
    const uploadPath = path.join(__dirname, '../uploads/leads', subdir);
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

const contactBusinessCardStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadPath = path.join(__dirname, '../uploads/leads/business-cards');
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

const uploadContactBusinessCards = multer({
  storage: contactBusinessCardStorage,
  fileFilter: (req, file, cb) => {
    if (!file.mimetype || !file.mimetype.startsWith('image/')) {
      return cb(new Error('Contact business card uploads must be image files.'), false);
    }
    cb(null, true);
  },
  limits: {
    fileSize: 10 * 1024 * 1024,
    files: 20,
  },
});

const uploadLeadFiles = multer({
  storage: leadUploadStorage,
  fileFilter: (req, file, cb) => {
    const isImage = file.mimetype && file.mimetype.startsWith('image/');
    const isPdf = file.mimetype === 'application/pdf';

    if (isContactBusinessCardField(file.fieldname)) {
      if (!isImage) {
        return cb(new Error('Contact business card uploads must be image files.'), false);
      }
      return cb(null, true);
    }

    if (!isImage && !isPdf) {
      return cb(new Error('Only image or PDF files are allowed for electricity bills.'), false);
    }
    cb(null, true);
  },
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB per file
    files: 40,
  },
});

router.get('/lead-sources', verifyToken, leadController.getLeadSources);
router.get('/leads/sales-persons', verifyToken, leadController.listSalesPersons);
router.get('/leads', verifyToken, leadController.listLeads);
router.get('/leads/:id', verifyToken, leadController.getLead);
router.get('/leads/:id/contacts', verifyToken, leadController.getLeadContacts);
router.post(
  '/leads/:id/contacts',
  verifyToken,
  uploadContactBusinessCards.any(),
  leadController.saveLeadContacts
);
router.get('/leads/:id/notes', verifyToken, leadController.getLeadNotes);
router.post('/leads/:id/notes', verifyToken, leadController.addLeadNote);
router.get('/leads/:id/activities', verifyToken, leadController.getLeadActivities);
router.post('/leads/:id/activities', verifyToken, leadController.addLeadActivity);
router.post(
  '/leads-create',
  verifyToken,
  uploadLeadFiles.any(),
  leadController.createLead
);
router.post('/leads/:id/assign', verifyToken, leadController.assignLeadToSalesPerson);
router.post('/leads/:id/lost', verifyToken, leadController.markLeadAsLost);
router.post('/leads/:id/convert', verifyToken, leadController.convertToCustomer);
router.post('/leads/:id/status', verifyToken, leadController.updateLeadStatus);
router.post('/leads/update-status', verifyToken, leadController.updateLeadStatusById);
router.get('/leads-user', verifyToken, leadController.getLeadsByUser);

module.exports = router;
