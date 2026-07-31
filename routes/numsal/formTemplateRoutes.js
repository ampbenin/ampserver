const express = require("express");
const router = express.Router();

const ctrl = require("../../controllers/numsal/formTemplateController");
const authMiddleware = require("../../middlewares/numsal/authMiddleware");
const roleMiddleware = require("../../middlewares/gestionamp/roleMiddleware");

// 🔐 Réservé aux comptes FORMATEUR/ADMIN — jamais public, ni tuteur/apprenant.
router.use(authMiddleware, roleMiddleware("FORMATEUR", "ADMIN"));

router.get("/", ctrl.listTemplates);
router.post("/", ctrl.createTemplate);
router.delete("/:id", ctrl.deleteTemplate);

module.exports = router;
