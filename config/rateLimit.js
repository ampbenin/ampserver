const rateLimit = require("express-rate-limit");

exports.publicApiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 100, // 100 requêtes / IP
  standardHeaders: true,
  legacyHeaders: false,
});

// Limite les tentatives de connexion / mot de passe oublié pour freiner le
// brute-force, sans bloquer un usage normal (quelques essais par oubli).
exports.authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 10, // 10 tentatives / IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Trop de tentatives, réessayez dans quelques minutes." },
});
