const express = require("express");
const { saveVolunteerForm } = require("../controllers/volunteerFormController");

const router = express.Router();

router.post("/", saveVolunteerForm);

module.exports = router;
