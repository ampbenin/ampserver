/**
 * Modèle HomeStat – Plateforme NumSAL
 * Une statistique affichée dans la section chiffres-clés de la page
 * d'accueil publique. Entièrement définie à la main par l'admin (valeur +
 * libellé + icône), pas calculée depuis la base de données — l'admin peut
 * ainsi mettre en avant des chiffres qui n'ont pas d'équivalent direct dans
 * une collection (ex: nombre de partenaires stratégiques, taux de
 * satisfaction) au même titre que des chiffres réels (apprenants, cours).
 */

const mongoose = require("mongoose");

const NumsalHomeStatSchema = new mongoose.Schema(
  {
    label: { type: String, required: true, trim: true },
    value: { type: String, required: true, trim: true },
    icon: { type: String, default: "" },
    // Ordre d'affichage sur la page d'accueil.
    order: { type: Number, default: 0 },
  },
  { timestamps: true }
);

module.exports = function getNumsalHomeStatModel() {
  const formDB = global.formDB;

  if (!formDB) {
    throw new Error("❌ formDB non initialisée (NumsalHomeStat)");
  }

  return formDB.models.NumsalHomeStat || formDB.model("NumsalHomeStat", NumsalHomeStatSchema);
};
