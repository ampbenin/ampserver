/**
 * Middleware JWT — comptes volontaires ("Mon espace")
 * Même mécanique que middlewares/numsal/authMiddleware.js et
 * middlewares/gestionamp/authMiddleware.js, avec le secret JWT dédié
 * (config/jwt.js -> jwtConfig.volunteer). Pas de gestion mustChangePassword
 * ici — inutile pour ce système (voir models/volunteer.js).
 */

const jwt = require("jsonwebtoken");
const jwtConfig = require("../../config/jwt");

module.exports = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Accès non autorisé" });
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, jwtConfig.volunteer.secret);
    req.user = decoded;
    next();
  } catch (error) {
    res.status(401).json({ message: "Token invalide ou expiré" });
  }
};
