const express = require("express");
const router = express.Router();

const ctrl = require("../../controllers/numsal/mentorNoteController");
const authMiddleware = require("../../middlewares/numsal/authMiddleware");
const roleMiddleware = require("../../middlewares/gestionamp/roleMiddleware");

router.use(authMiddleware);

router.post("/", roleMiddleware("TUTEUR"), ctrl.addNote);
router.get("/learner/:learnerId", roleMiddleware("TUTEUR", "ADMIN"), ctrl.listNotesForLearner);

module.exports = router;
