const express = require('express');
const roleController = require('../controllers/roleController');
const { verifyToken } = require('../middleware/authMiddleware');

const router = express.Router();

// Apply verifyToken to all routes or specific ones as needed
router.post('/', verifyToken, roleController.createRole);
router.get('/', verifyToken, roleController.listRoles);
router.get('/:id', verifyToken, roleController.getRole);
router.delete('/:id', verifyToken, roleController.deleteRole);

module.exports = router;
