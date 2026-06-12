const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const userController = require('../controllers/userController');
const { verifyToken } = require('../middleware/authMiddleware');

const router = express.Router();

const profileStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadPath = path.join(__dirname, '../uploads/profiles');
    fs.mkdirSync(uploadPath, { recursive: true });
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    const timestamp = Date.now();
    const safeName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
    cb(null, `${timestamp}-${safeName}`);
  },
});

const uploadProfileImage = multer({
  storage: profileStorage,
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      return cb(new Error('Only image files are allowed.'), false);
    }
    cb(null, true);
  },
  limits: {
    fileSize: 5 * 1024 * 1024,
  },
});

router.post('/user-create', verifyToken, userController.createUser);
router.post('/send-otp', userController.sendUserOtp);
router.post('/verify-otp', userController.verifyUserOtp);
router.get('/user-list', verifyToken, userController.listUsers);
router.get('/contractors', verifyToken, userController.listContractors);
router.get('/sales-persons', verifyToken, userController.listSalesPersons);
router.get('/profile', verifyToken, userController.getProfile);
router.post(
  '/profile/image',
  verifyToken,
  uploadProfileImage.single('image'),
  userController.uploadProfileImage
);
router.get('/working-hours', verifyToken, userController.getUserWorkingHours);
router.post('/working-hours', verifyToken, userController.getUserWorkingHours);
router.get('/:id([0-9a-fA-F]{24})', verifyToken, userController.getUser);

module.exports = router;
