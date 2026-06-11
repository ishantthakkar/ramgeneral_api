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

router.post('/create-surveys', verifyToken, surveyController.createNewSurvey);
router.post('/add-area', verifyToken, upload.any(), surveyController.createSurvey);
router.get('/surveys', verifyToken, surveyController.listSurveys);
router.get('/surveys/products', verifyToken, surveyController.getSurveyProducts);
router.get('/surveys/assigned', verifyToken, surveyController.listAssignedSurveys);
router.get('/surveys/:id', verifyToken, surveyController.getSurvey);
router.put('/surveys/:id', verifyToken, surveyController.updateSurvey);
router.post('/surveys/:id/assign', verifyToken, surveyController.assignSurvey);
router.post('/surveys/:id/assign-contractor', verifyToken, surveyController.assignContractor);
router.post('/surveys/name', verifyToken, surveyController.updateSurveyName);
router.post('/surveys/notes', verifyToken, surveyController.updateSurveyNotes);
router.post('/surveys/mark-completed', verifyToken, surveyController.markSurveyCompleted);
router.post('/surveys/verify', verifyToken, upload.any(), surveyController.verifySurvey);
router.post('/surveys/:id/confirm-verify', verifyToken, surveyController.confirmVerifySurvey);
router.get('/installation', verifyToken, surveyController.installation);

module.exports = router;
