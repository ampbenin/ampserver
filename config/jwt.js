/**
 * Configuration JWT centralisée
 */

module.exports = {
  secret: process.env.JWT_SECRET,
  expiresIn: "1d", // token valable 24h

  // Secret dédié pour la plateforme NumSAL (sous-domaine indépendant) —
  // repli sur le secret principal si non défini, pour ne jamais bloquer
  // le démarrage si la variable n'a pas encore été ajoutée en prod.
  numsal: {
    secret: process.env.JWT_SECRET_NUMSAL || process.env.JWT_SECRET,
    expiresIn: "1d",
  },

  // Secret dédié pour "Mon espace" (comptes volontaires, publics) — durée
  // plus longue que l'admin : usage occasionnel, faible enjeu de sécurité,
  // on évite de forcer une reconnexion fréquente pour ce public.
  volunteer: {
    secret: process.env.JWT_SECRET_VOLUNTEER || process.env.JWT_SECRET,
    expiresIn: "7d",
  },
};
