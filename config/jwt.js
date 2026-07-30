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
};
