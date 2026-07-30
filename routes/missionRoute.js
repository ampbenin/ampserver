const express = require("express");
const {
  createMission,
  getMissions,
  getMissionById,
  updateMission,
  deleteMission,
  findMissionByTitle,
} = require("../controllers/missionController");
const authMiddleware = require("../middlewares/gestionamp/authMiddleware");
const roleMiddleware = require("../middlewares/gestionamp/roleMiddleware");

const router = express.Router();

router.use(authMiddleware, roleMiddleware("ADMIN", "EDITOR"));

router.post("/", createMission);
router.get("/", getMissions);
router.get("/:id", getMissionById);
router.put("/:id", updateMission);
router.delete("/:id", deleteMission);
router.post("/find-by-title", findMissionByTitle);

module.exports = router;
