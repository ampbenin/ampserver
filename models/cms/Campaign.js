/**
 * Modèle Campaign – CMS AMP BENIN (DB2)
 * Couvre la micro-site "16 jours d'activisme" (et de futures campagnes
 * similaires). Un document par campagne (`slug`).
 *
 * Périmètre volontairement ciblé (décision utilisateur, phase 3 du plan de
 * refonte) : seuls les blocs déjà pilotés par un tableau de données dans le
 * code (Actu/Stats/Timeline/Galerie) + les articles journaliers sont couverts
 * ici. Les 10 autres sections de la page 16jours.astro (en-tête, à propos,
 * engagements, témoignages, actions, newsletter, mur social, partenaires,
 * FAQ, carte) restent gérées en code pour l'instant.
 */

const mongoose = require("mongoose");

const CampaignSchema = new mongoose.Schema(
  {
    slug: { type: String, required: true, unique: true, trim: true },

    sections: {
      actuImages: { type: [String], default: [] },
      stats: [
        {
          number: String,
          label: String,
        },
      ],
      timeline: [
        {
          date: String,
          event: String,
        },
      ],
      gallery: { type: [String], default: [] },
    },

    dailyArticles: [
      {
        day: { type: Number, required: true },
        title: { type: String, default: "" },
        date: { type: String, default: "" },
        body: { type: String, default: "" },
        gallery: { type: [String], default: [] },
      },
    ],

    status: {
      type: String,
      enum: ["DRAFT", "PUBLISHED"],
      default: "DRAFT",
    },

    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "GestionAmpUser",
      default: null,
    },
  },
  { timestamps: true }
);

module.exports = function getCampaignModel() {
  const formDB = global.formDB;

  if (!formDB) {
    throw new Error("❌ formDB non initialisée (Campaign)");
  }

  return formDB.models.CmsCampaign || formDB.model("CmsCampaign", CampaignSchema);
};
