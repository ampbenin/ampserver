const express = require("express");
const multer = require("multer");
const router = express.Router();

const ctrl = require("../controllers/volunteerProgramController");
const authMiddleware = require("../middlewares/gestionamp/authMiddleware");
const roleMiddleware = require("../middlewares/gestionamp/roleMiddleware");

const requireStaff = [authMiddleware, roleMiddleware("ADMIN", "EDITOR")];
// Affecter/retirer un EDITOR d'un programme (donne les pleins pouvoirs
// "comme ADMIN" sur ce programme, voir controller) — réservé ADMIN, jamais
// un EDITOR ne peut s'auto-affecter ni affecter un autre EDITOR.
const requireAdminOnly = [authMiddleware, roleMiddleware("ADMIN")];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, file.mimetype.startsWith("image/")),
});

// 🌐 Public — catalogue des programmes publiés + schéma du formulaire de candidature
router.get("/", ctrl.listPublicPrograms);
router.get("/:id/application-form", ctrl.getApplicationForm);

// 🔐 Staff (ADMIN/EDITOR) — gestion des programmes
// ("/all" déclaré avant "/:id" pour ne pas être capté par le paramètre générique)
//
// /all et /:id sont ouvertes à n'importe quel rôle connecté (authMiddleware
// seul) — retour utilisateur, 2026-11-24 : un compte EC/IS/SUPERVISEUR/
// PARTENAIRE affecté comme réviseur (program.reviewerIds, voir
// canReviewProgram) doit pouvoir voir le programme qui lui est confié pour
// en traiter les candidatures, sans pour autant accéder à ses réglages
// (create/put/delete/supervisors/partners/editors restent requireStaff).
// Le filtrage fin reste entièrement fait par le contrôleur
// (listAllPrograms/getProgramById), exactement comme pour le recrutement
// (routes/cms/jobs.js).
router.get("/all", authMiddleware, ctrl.listAllPrograms);
router.post("/", ...requireStaff, ctrl.createProgram);
router.get("/:id", authMiddleware, ctrl.getProgramById);
router.put("/:id", ...requireStaff, ctrl.updateProgramMeta);
router.delete("/:id", ...requireStaff, ctrl.deleteProgram);
router.patch("/:id/reviewer-scope", ...requireStaff, ctrl.setReviewerScope);
router.patch("/:id/supervisors", ...requireStaff, ctrl.setSupervisorAssignment);
router.patch("/:id/partners", ...requireStaff, ctrl.setPartnerAccess);
router.patch("/:id/editors", ...requireAdminOnly, ctrl.setEditorAccess);
router.post("/:id/partners-bar", ...requireStaff, upload.single("file"), ctrl.uploadPartnersBarImage);

module.exports = router;
