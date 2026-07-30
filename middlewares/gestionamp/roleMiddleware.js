/**
 * Middleware de contrôle par rôle
 *
 * Exemple :
 *   roleMiddleware("ADMIN")
 *   roleMiddleware("ADMIN", "EC")
 */

module.exports = (...allowedRoles) => {
  return (req, res, next) => {
    const { role } = req.user;

    if (!allowedRoles.includes(role)) {
      return res.status(403).json({
        message: "Accès refusé : rôle non autorisé",
      });
    }

    next();
  };
};
