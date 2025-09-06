// middlewares/errorHandler.js

// Middleware global de gestion des erreurs
const errorHandler = (err, req, res, next) => {
  console.error(err.stack); // Log de l'erreur pour debug

  // Si une réponse a déjà été envoyée, passer au suivant
  if (res.headersSent) {
    return next(err);
  }

  // Réponse JSON standardisée
  res.status(err.status || 500).json({
    success: false,
    message: err.message || "Erreur serveur interne",
  });
};

module.exports = { errorHandler };
