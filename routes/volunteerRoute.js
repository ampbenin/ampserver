// routes/volunteerRoute

const express = require("express");
const {
  createVolunteer,
  fetchVolunteersForCertificate,
    // 🔽 VolunteersManager
  listVolunteers,
  getVolunteerById,
  updateVolunteer,
  deleteVolunteer,
  assignVolunteerMission,
} = require("../controllers/volunteerController");

const router = express.Router();

router.post("/", createVolunteer);
router.post("/certificates", fetchVolunteersForCertificate);
router.get("/", listVolunteers);                     // GET /api/volunteers?search=...&statut=...&missionId=...&missionTitre=...
router.get("/:id", getVolunteerById);               // GET /api/volunteers/:id
router.put("/:id", updateVolunteer);                // PUT /api/volunteers/:id
router.delete("/:id", deleteVolunteer);             // DELETE /api/volunteers/:id
router.post("/:id/assign-mission", assignVolunteerMission);  // POST /api/volunteers/:id/assign-mission


module.exports = router;
