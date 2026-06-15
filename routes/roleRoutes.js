const express = require('express');
const roleController = require('../controllers/roleController');
const { verifyToken, requireAdmin } = require('../middleware/authMiddleware');

const router = express.Router();

router.post('/', verifyToken, requireAdmin, roleController.createRole);
router.get('/', verifyToken, roleController.listRoles);
router.get('/:id', verifyToken, roleController.getRole);
router.delete('/:id', verifyToken, requireAdmin, roleController.deleteRole);

module.exports = router;
