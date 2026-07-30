/**
 * Middleware de protection API publique
 */

module.exports = (req, res, next) => {
  const apiKey = req.headers["x-public-api-key"];

  if (!apiKey || apiKey !== process.env.PUBLIC_API_KEY) {
    return res.status(401).json({
      message: "Clé API publique invalide ou absente",
    });
  }

  next();
};
