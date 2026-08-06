/**
 * Petit utilitaire de log d'activité partenaire — voir models/partnerActivityLog.js.
 * Volontairement tolérant aux pannes : le suivi d'activité est un outil
 * d'observation pour le staff, jamais une fonctionnalité critique — une
 * erreur ici (formDB pas encore prête, etc.) ne doit JAMAIS faire échouer
 * la vraie requête de l'appelant.
 */

const getPartnerActivityLogModel = require("../models/partnerActivityLog");

async function logPartnerActivity({ partnerId, programId = null, action, metadata = {} }) {
  try {
    const PartnerActivityLog = getPartnerActivityLogModel();
    await PartnerActivityLog.create({ partnerId, programId, action, metadata });
  } catch (error) {
    console.error("⚠️ Erreur log activité partenaire (ignorée) :", error.message);
  }
}

module.exports = { logPartnerActivity };
