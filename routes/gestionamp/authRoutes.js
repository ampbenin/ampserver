const express = require("express");
const router = express.Router();

const authController = require("../../controllers/gestionamp/authController");
const authMiddleware = require("../../middlewares/gestionamp/authMiddleware");
const { authLimiter } = require("../../config/rateLimit");

// 🔐 Connexion
router.post("/login", authLimiter, authController.login);

// 🔐 Profil courant (utilisé par useAuthAMP.js — endpoint manquant jusqu'ici,
// ce qui faisait échouer systématiquement la garde d'accès des dashboards)
router.get("/me", authMiddleware, authController.me);

// 🔐 Changement de mot de passe (protégé — accessible même si mustChangePassword=true)
router.post("/change-password", authMiddleware, authController.changePassword);

// 🔐 Mot de passe oublié / réinitialisation (publiques, limitées en débit)
router.post("/forgot-password", authLimiter, authController.forgotPassword);
router.post("/reset-password", authLimiter, authController.resetPassword);

module.exports = router;
