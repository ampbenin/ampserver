/**
 * Client Resend — transporteur email unique du site (candidature/admission
 * NumSAL, mot de passe oublié gestionamp et NumSAL, newsletter). Remplace
 * l'ancien transporteur SMTP/nodemailer (utils/mailer.js, supprimé) pour
 * éviter d'avoir à configurer un compte SMTP séparé en plus de Resend.
 */
const { Resend } = require("resend");

// Le SDK Resend lève une exception à la construction si la clé est absente
// (contrairement à Sentry, qui s'auto-désactive silencieusement) — tant que
// RESEND_API_KEY n'est pas configurée, on expose un stub qui rejette au lieu
// de faire planter tout le serveur au démarrage.
const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : { emails: { send: () => Promise.reject(new Error("RESEND_API_KEY non configurée")) } };

module.exports = resend;
