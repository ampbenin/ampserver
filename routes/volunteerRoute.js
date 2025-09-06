const express = require("express");
const {
  createVolunteer,
  fetchVolunteersForCertificate,
  generateCertificate,
} = require("../controllers/volunteerController");

const router = express.Router();

router.post("/", createVolunteer);
router.post("/certificates", fetchVolunteersForCertificate);
router.post("/generate-certificates", generateCertificate);

module.exports = router;
