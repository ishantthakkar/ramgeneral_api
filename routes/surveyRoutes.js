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
    fileSize: 10 * 1024 * 1024,
  },
});

router.post('/surveys', verifyToken, upload.array('images', 5), surveyController.createSurvey);
router.get('/surveys', verifyToken, surveyController.listSurveys);
router.get('/surveys/assigned', verifyToken, surveyController.listAssignedSurveys);
router.get('/surveys/:id', verifyToken, surveyController.getSurvey);
router.put('/surveys/:id', verifyToken, surveyController.updateSurvey);
router.post('/surveys/:id/assign', verifyToken, surveyController.assignSurvey);
router.post('/surveys/:id/assign-contractor', verifyToken, surveyController.assignContractor);
router.get('/installation', verifyToken, surveyController.installation);

module.exports = router;
