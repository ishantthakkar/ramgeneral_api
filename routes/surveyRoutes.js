const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const surveyController = require('../controllers/surveyController');
const { verifyToken } = require('../middleware/authMiddleware');

const router = express.Router();

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadPath = path.join(__dirname, '../uploads/surveys');
    fs.mkdirSync(uploadPath, { recursive: true });
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    const uniquePrefix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const safeName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
    cb(null, `${uniquePrefix}-${safeName}`);
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
    fileSize: 10 * 1024 * 1024,
    files: 50,
  },
});

const receiptStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadPath = path.join(__dirname, '../uploads/surveys/receipts');
    fs.mkdirSync(uploadPath, { recursive: true });
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    const uniquePrefix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const safeName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
    cb(null, `${uniquePrefix}-${safeName}`);
  },
});

const uploadReceipt = multer({
  storage: receiptStorage,
  fileFilter: (req, file, cb) => {
    const allowed =
      file.mimetype.startsWith('image/') ||
      file.mimetype === 'application/pdf' ||
      file.mimetype === 'application/octet-stream';
    if (!allowed) {
      return cb(new Error('Only image or PDF files are allowed for receipts.'), false);
    }
    cb(null, true);
  },
  limits: {
    fileSize: 10 * 1024 * 1024,
    files: 20,
  },
});

router.post('/create-surveys', verifyToken, surveyController.createNewSurvey);
router.post('/add-area', verifyToken, upload.any(), surveyController.createSurvey);
router.get('/surveys', verifyToken, surveyController.listSurveys);
router.get('/surveys/products', verifyToken, surveyController.getSurveyProducts);
router.get('/surveys/assigned', verifyToken, surveyController.listAssignedSurveys);
router.get('/surveys/:id/installation-workflow', verifyToken, surveyController.getInstallationWorkflow);
router.get('/surveys/:id', verifyToken, surveyController.getSurvey);
router.put('/surveys/:id', verifyToken, surveyController.updateSurvey);
router.post('/surveys/assign', verifyToken, surveyController.assignSurvey);
router.post('/surveys/assign-contractor', verifyToken, surveyController.assignContractor);
router.post('/surveys/name', verifyToken, surveyController.updateSurveyName);
router.post('/surveys/notes', verifyToken, surveyController.updateSurveyNotes);
router.post('/surveys/area-report', verifyToken, upload.any(), surveyController.saveAreaReport);
router.post('/surveys/area-verification', verifyToken, upload.any(), surveyController.saveAreaVerification);
router.post(
  '/surveys/extra-expenses',
  verifyToken,
  uploadReceipt.fields([
    { name: 'upload_receipts', maxCount: 20 },
    { name: 'uploadReceipts', maxCount: 20 },
    { name: 'upload_receipt', maxCount: 1 },
    { name: 'uploadReceipt', maxCount: 1 },
  ]),
  surveyController.saveExtraExpenses
);
router.get('/surveys/extra-expenses', verifyToken, surveyController.getExtraExpenses);
router.get('/surveys/:id/extra-expenses', verifyToken, surveyController.getExtraExpenses);
router.post('/surveys/mark-completed', verifyToken, surveyController.markSurveyCompleted);
router.post('/surveys/verify', verifyToken, upload.any(), surveyController.verifySurvey);
router.post('/surveys/:id/confirm-verify', verifyToken, surveyController.confirmVerifySurvey);
router.get('/workflow-surveys', verifyToken, surveyController.listWorkflowSurveys);
router.get('/installation', verifyToken, surveyController.installation);

module.exports = router;
