const express = require('express');
const productController = require('../controllers/productController');
const { verifyToken } = require('../middleware/authMiddleware');

const router = express.Router();

router.get('/', verifyToken, productController.listProducts);
router.get('/proposed-fixtures', verifyToken, productController.listProposedFixtureProducts);
router.post('/', verifyToken, productController.createProduct);
router.put('/:id', verifyToken, productController.updateProduct);
router.get('/:id', verifyToken, productController.getProduct);

module.exports = router;
