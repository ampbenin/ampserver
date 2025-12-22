const express = require('express');
const router = express.Router();
const contactCtrl = require('../../controllers/admin/contactController');

router.get('/', contactCtrl.getAll);             
router.patch('/:id/handled', contactCtrl.markHandled);
router.delete('/:id', contactCtrl.delete);

module.exports = router;
