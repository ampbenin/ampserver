const express = require("express");
const router = express.Router();
const { savePartner } = require("../controllers/partnerController");

// POST /api/partner-form
router.post("/", savePartner);

module.exports = router;
