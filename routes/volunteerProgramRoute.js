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
router.get("/all", ...requireStaff, ctrl.listAllPrograms);
router.post("/", ...requireStaff, ctrl.createProgram);
router.get("/:id", ...requireStaff, ctrl.getProgramById);
router.put("/:id", ...requireStaff, ctrl.updateProgramMeta);
router.delete("/:id", ...requireStaff, ctrl.deleteProgram);
router.patch("/:id/supervisors", ...requireStaff, ctrl.setSupervisorAssignment);
router.patch("/:id/partners", ...requireStaff, ctrl.setPartnerAccess);
router.patch("/:id/editors", ...requireAdminOnly, ctrl.setEditorAccess);
router.post("/:id/partners-bar", ...requireStaff, upload.single("file"), ctrl.uploadPartnersBarImage);

module.exports = router;
