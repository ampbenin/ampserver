const express = require("express");
const router = express.Router();

const ctrl = require("../controllers/volunteerDisciplineController");
const authMiddleware = require("../middlewares/gestionamp/authMiddleware");
const roleMiddleware = require("../middlewares/gestionamp/roleMiddleware");

// Signalement : ADMIN/EDITOR/SUPERVISEUR/PARTENAIRE — scope exact vérifié
// dans le contrôleur (canReportVolunteer), pas ici.
const requireReporter = [authMiddleware, roleMiddleware("ADMIN", "EDITOR", "SUPERVISEUR", "PARTENAIRE")];
// Traitement des signalements + sanctions : ADMIN UNIQUEMENT (décision
// explicite de l'utilisateur — même EDITOR n'y a pas accès ici).
const requireAdmin = [authMiddleware, roleMiddleware("ADMIN")];
// Lecture (historique par volontaire, liste noire) : tout le staff qui
// gère déjà des candidatures/volontaires.
const requireStaff = [authMiddleware, roleMiddleware("ADMIN", "EDITOR", "SUPERVISEUR", "PARTENAIRE")];

router.post("/reports", ...requireReporter, ctrl.submitReport);
router.get("/reports", ...requireAdmin, ctrl.listReports);
router.patch("/reports/:id/dismiss", ...requireAdmin, ctrl.dismissReport);

router.post("/sanctions", ...requireAdmin, ctrl.applySanction);
router.patch("/sanctions/:id/lift", ...requireAdmin, ctrl.liftSanction);
router.get("/sanctions/active", ...requireAdmin, ctrl.listActiveSanctions);

router.get("/volunteers/:id/sanctions", ...requireStaff, ctrl.listVolunteerSanctions);
router.get("/blacklist", ...requireStaff, ctrl.listBlacklist);

module.exports = router;
