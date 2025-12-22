// routes/admin/members.js
const express = require('express');
const router = express.Router();
const ctrl = require('../../controllers/admin/memberController');

router.get('/', ctrl.getAll);
router.patch('/:id/approve', ctrl.approve);
router.delete('/:id', ctrl.delete);

module.exports = router;
