/**
 * Middleware d'isolation par espace (multi-tenant)
 *
 * Règles :
 * - ADMIN → accès global
 * - EC → accès limité à sa Coordination Communale
 * - IS → accès limité à son Institution Spécialisée
 *
 * Ce middleware :
 * - injecte un filtre d'espace dans req.spaceFilter
 * - doit être utilisé AVANT les contrôleurs métier
 */

module.exports = (req, res, next) => {
  const { role, coordinationCommunaleId, institutionSpecialiseeId } = req.user;

  // 🔓 ADMIN : accès total
  if (role === "ADMIN") {
    req.spaceFilter = {}; // aucun filtrage
    return next();
  }

  // 🟢 EC : filtrage par coordination communale
  if (role === "EC") {
    if (!coordinationCommunaleId) {
      return res.status(403).json({
        message: "Accès refusé : aucune coordination communale associée",
      });
    }

    req.spaceFilter = {
      coordinationCommunaleId,
    };
    return next();
  }

  // 🔵 IS : filtrage par institution spécialisée
  if (role === "IS") {
    if (!institutionSpecialiseeId) {
      return res.status(403).json({
        message: "Accès refusé : aucune institution spécialisée associée",
      });
    }

    req.spaceFilter = {
      institutionSpecialiseeId,
    };
    return next();
  }

  // ❌ Rôle inconnu
  return res.status(403).json({
    message: "Accès refusé : rôle non autorisé",
  });
};
