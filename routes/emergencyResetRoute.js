const express = require("express");
const router = express.Router();

const ctrl = require("../controllers/emergencyResetController");
const authMiddleware = require("../middlewares/gestionamp/authMiddleware");
const roleMiddleware = require("../middlewares/gestionamp/roleMiddleware");

// 🔐 ADMIN uniquement — outil de contournement d'authentification,
// volontairement plus restreint que le reste de l'espace admin (jamais
// ouvert à EDITOR).
const requireAdmin = [authMiddleware, roleMiddleware("ADMIN")];

router.post("/batches", ...requireAdmin, ctrl.createBatch);
router.get("/batches", ...requireAdmin, ctrl.listBatches);
router.patch("/batches/:id/deactivate", ...requireAdmin, ctrl.deactivateBatch);

// 🌐 Public — le lien d'urgence lui-même (partagé par l'ADMIN hors du
// système, WhatsApp/oral/affichage — pas d'email automatique, décision
// utilisateur du 2026-08-14).
router.get("/:token", ctrl.checkLink);
router.post("/:token/verify", ctrl.verifyIdentity);
router.post("/:token/reset", ctrl.resetPassword);

module.exports = router;
