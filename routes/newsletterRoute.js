// routes/newsletterRoute.js
const express = require("express");
const router = express.Router();
const { subscribeNewsletter } = require("../controllers/newsletterController");

// POST /api/newsletter
router.post("/", subscribeNewsletter);

module.exports = router;
