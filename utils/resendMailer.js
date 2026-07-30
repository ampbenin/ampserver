/**
 * Client Resend — utilisé uniquement pour le mail de réception de
 * candidature NumSAL (courseController.applyToCourse). Les autres emails
 * du site (admission NumSAL, mot de passe oublié, newsletter) restent sur
 * le transporteur SMTP existant (utils/mailer.js) — pas de migration
 * globale demandée pour l'instant.
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
