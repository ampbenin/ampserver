const express = require("express");
const router = express.Router();

const ctrl = require("../controllers/volunteerAuthController");
const authMiddleware = require("../middlewares/volunteer/authMiddleware");
const { authLimiter } = require("../config/rateLimit");

// 🌐 Public — comptes "Mon espace" (voir le plan de ce chantier)
router.post("/register", authLimiter, ctrl.register);
router.post("/login", authLimiter, ctrl.login);
router.post("/request-password-link", authLimiter, ctrl.requestPasswordLink);
router.post("/set-password", authLimiter, ctrl.setPassword);

// 🔐 Protégé — profil du volontaire connecté
router.get("/me", authMiddleware, ctrl.me);

module.exports = router;
