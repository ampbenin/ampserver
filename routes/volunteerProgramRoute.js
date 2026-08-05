const express = require("express");
const router = express.Router();

const ctrl = require("../controllers/volunteerProgramController");
const authMiddleware = require("../middlewares/gestionamp/authMiddleware");
const roleMiddleware = require("../middlewares/gestionamp/roleMiddleware");

const requireStaff = [authMiddleware, roleMiddleware("ADMIN", "EDITOR")];

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

module.exports = router;
