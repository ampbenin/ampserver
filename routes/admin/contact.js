const express = require('express');
const router = express.Router();
const contactCtrl = require('../../controllers/admin/contactController');
const authMiddleware = require('../../middlewares/gestionamp/authMiddleware');
const roleMiddleware = require('../../middlewares/gestionamp/roleMiddleware');

router.use(authMiddleware, roleMiddleware('ADMIN'));

router.get('/', contactCtrl.getAll);
router.patch('/:id/handled', contactCtrl.markHandled);
router.delete('/:id', contactCtrl.delete);

module.exports = router;
