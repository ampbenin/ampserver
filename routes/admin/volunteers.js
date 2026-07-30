// routes/admin/volunteers.js
const express = require('express');
const router = express.Router();
const ctrl = require('../../controllers/admin/volunteerController');
const authMiddleware = require('../../middlewares/gestionamp/authMiddleware');
const roleMiddleware = require('../../middlewares/gestionamp/roleMiddleware');

router.use(authMiddleware, roleMiddleware('ADMIN'));

router.get('/', ctrl.getAll);
router.patch('/:id/approve', ctrl.approve);
router.post('/:id/promote', ctrl.promote);
router.delete('/:id', ctrl.delete);

module.exports = router;
