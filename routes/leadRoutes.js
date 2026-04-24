const express = require('express');
const leadController = require('../controllers/leadController');
const { verifyToken } = require('../middleware/authMiddleware');

const router = express.Router();

router.get('/leads', verifyToken, leadController.listLeads);
router.get('/leads/:id', verifyToken, leadController.getLead);
router.post('/leads', verifyToken, leadController.createLead);
router.put('/leads/:id', verifyToken, leadController.updateLead);
router.post('/leads/:id/convert', verifyToken, leadController.convertToCustomer);
router.post('/leads/:id/status', verifyToken, leadController.updateLeadStatus);

module.exports = router;
