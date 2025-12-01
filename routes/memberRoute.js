const express = require('express');
const { saveMember } = require('../controllers/memberController');

const router = express.Router();

router.post("/", saveMember);

module.exports = router;
