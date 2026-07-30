/**
 * Middleware JWT — plateforme NumSAL
 * Même mécanique que middlewares/gestionamp/authMiddleware.js, avec le
 * secret JWT dédié à NumSAL (config/jwt.js -> jwtConfig.numsal).
 */

const jwt = require("jsonwebtoken");
const jwtConfig = require("../../config/jwt");

const CHANGE_PASSWORD_PATH = "/change-password";

module.exports = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Accès non autorisé" });
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, jwtConfig.numsal.secret);

    if (decoded.mustChangePassword && !req.originalUrl.endsWith(CHANGE_PASSWORD_PATH)) {
      return res.status(403).json({
        message: "Vous devez changer votre mot de passe avant de continuer",
        mustChangePassword: true,
      });
    }

    req.user = decoded;
    next();
  } catch (error) {
    res.status(401).json({ message: "Token invalide ou expiré" });
  }
};
