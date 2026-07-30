/**
 * Middleware JWT
 * Vérifie l'authentification et injecte req.user
 */

const jwt = require("jsonwebtoken");
const jwtConfig = require("../../config/jwt");

// Seule route accessible à un utilisateur dont mustChangePassword=true.
const CHANGE_PASSWORD_PATH = "/change-password";

module.exports = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Accès non autorisé" });
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, jwtConfig.secret);

    if (decoded.mustChangePassword && !req.originalUrl.endsWith(CHANGE_PASSWORD_PATH)) {
      return res.status(403).json({
        message: "Vous devez changer votre mot de passe avant de continuer",
        mustChangePassword: true,
      });
    }

    req.user = decoded; // contient id, role et espace
    next();
  } catch (error) {
    res.status(401).json({ message: "Token invalide ou expiré" });
  }
};
