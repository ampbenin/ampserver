/**
 * Modèle BlacklistedVolunteer — Archive des volontaires "indélicats"
 * bannis. Créée au moment d'un BAN (voir
 * controllers/volunteerDisciplineController.js#applySanction), qui
 * SUPPRIME en parallèle le document Volunteer correspondant — cette entrée
 * est donc la SEULE trace qui survit, utilisée pour surligner en rouge
 * toute nouvelle candidature (autre programme, autre email parfois) dont
 * l'email/téléphone/nom+prénom correspond (voir
 * GET /api/volunteer-discipline/blacklist, croisé côté client).
 *
 * Levée du bannissement = suppression de CETTE entrée (plus aucune trace,
 * le volontaire peut recréer un compte) — mais le compte Volunteer
 * d'origine, lui, ne revient jamais ("il ne peut plus retrouver son
 * compte", décision confirmée avec l'utilisateur).
 *
 * Vit sur la même connexion que Volunteer (par défaut, pas formDB).
 */

const mongoose = require("mongoose");

const BlacklistedVolunteerSchema = new mongoose.Schema(
  {
    nom: { type: String, required: true },
    prenom: { type: String, required: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    telephone: { type: String, default: "" },
    reason: { type: String, required: true, trim: true },
    bannedAt: { type: Date, default: Date.now },
    bannedBy: { type: mongoose.Schema.Types.ObjectId, required: true },
    // Référence morte (le document Volunteer original est supprimé) —
    // conservée uniquement pour mémoire/traçabilité.
    originalVolunteerId: { type: mongoose.Schema.Types.ObjectId, default: null },
    sanctionId: { type: mongoose.Schema.Types.ObjectId, ref: "VolunteerSanction", default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.models.BlacklistedVolunteer || mongoose.model("BlacklistedVolunteer", BlacklistedVolunteerSchema);
