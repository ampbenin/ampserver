/**
 * Middleware JWT — comptes volontaires ("Mon espace")
 * Même mécanique que middlewares/numsal/authMiddleware.js et
 * middlewares/gestionamp/authMiddleware.js, avec le secret JWT dédié
 * (config/jwt.js -> jwtConfig.volunteer). Pas de gestion mustChangePassword
 * ici — inutile pour ce système (voir models/volunteer.js).
 *
 * Recharge le compte depuis la base à CHAQUE requête (pas seulement au
 * login) — sans quoi une suspension/un bannissement posé pendant qu'une
 * session est déjà ouverte n'aurait d'effet qu'à l'expiration du token (7
 * jours, voir jwtConfig.volunteer). Léger changement d'architecture
 * (ajoute une requête DB à ce middleware, jusqu'ici JWT-only) — volume
 * "Mon espace" largement compatible avec ce coût.
 */

const jwt = require("jsonwebtoken");
const jwtConfig = require("../../config/jwt");
const Volunteer = require("../../models/volunteer");

module.exports = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Accès non autorisé" });
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, jwtConfig.volunteer.secret);

    const volunteer = await Volunteer.findById(decoded.id).select("isActive");
    if (!volunteer) {
      // Compte introuvable = banni (voir volunteerDisciplineController.js#applySanction,
      // qui supprime le document Volunteer) ou supprimé autrement.
      return res.status(401).json({ message: "Compte introuvable ou suspendu" });
    }
    if (!volunteer.isActive) {
      return res.status(403).json({ message: "Votre compte est suspendu" });
    }

    req.user = decoded;
    next();
  } catch (error) {
    res.status(401).json({ message: "Token invalide ou expiré" });
  }
};
