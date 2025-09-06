const express = require("express");
const {
  createMission,
  getMissions,
  getMissionById,
  updateMission,
  deleteMission,
  findMissionByTitle,
} = require("../controllers/missionController");

const router = express.Router();

router.post("/", createMission);
router.get("/", getMissions);
router.get("/:id", getMissionById);
router.put("/:id", updateMission);
router.delete("/:id", deleteMission);
router.post("/find-by-title", findMissionByTitle);

module.exports = router;
