const express = require("express");
const router = express.Router();

const authController = require("../../controllers/numsal/authController");
const authMiddleware = require("../../middlewares/numsal/authMiddleware");
const { authLimiter } = require("../../config/rateLimit");

// 🔓 Inscription apprenant (libre-service)
router.post("/register", authLimiter, authController.register);

// 🔐 Connexion — plus de authLimiter (IP) ici : remplacé par une limite
// PAR COMPTE gérée directement dans authController.login (voir
// utils/loginAttemptLimiter.js), avec exemption ADMIN.
router.post("/login", authController.login);

// 🔐 Changement de mot de passe (protégé — accessible même si mustChangePassword=true)
router.post("/change-password", authMiddleware, authController.changePassword);

// 🔐 Mot de passe oublié / réinitialisation (publiques, limitées en débit)
router.post("/forgot-password", authLimiter, authController.forgotPassword);
router.post("/reset-password", authLimiter, authController.resetPassword);

module.exports = router;
