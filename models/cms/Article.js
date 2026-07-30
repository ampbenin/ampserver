/**
 * Modèle Article – CMS AMP BENIN (DB2)
 * Couvre les actualités et les articles longs (16jours, campagnes...).
 */

const mongoose = require("mongoose");

const ArticleSchema = new mongoose.Schema(
  {
    slug: { type: String, required: true, unique: true, trim: true },
    title: { type: String, required: true, trim: true },
    excerpt: { type: String, default: "" },
    coverImage: { type: String, default: "" },
    body: { type: String, default: "" },
    tags: { type: [String], default: [] },

    // Pont transitoire : tant qu'un article n'a pas de page de détail générée
    // depuis `body` (voir phase 4 du plan de refonte), la carte de la liste
    // des actualités peut pointer vers une page historique codée en dur.
    externalLink: { type: String, default: "" },

    date: { type: String, default: "" },

    stats: [
      {
        value: String,
        label: String,
        suffix: String,
        icon: String,
      },
    ],

    // Cartes "piliers" optionnelles affichées sous les stats (ex: PlaidoyerStats).
    pillars: [
      {
        icon: String,
        title: String,
        desc: String,
        color: String,
      },
    ],

    gallery: [
      {
        image: String,
        caption: String,
        label: String,
      },
    ],

    testimonials: [
      {
        name: String,
        role: String,
        quote: String,
        photo: String,
      },
    ],

    faq: [
      {
        question: String,
        answer: String,
      },
    ],

    status: {
      type: String,
      enum: ["DRAFT", "PUBLISHED"],
      default: "DRAFT",
    },

    publishedAt: { type: Date, default: null },

    // { en?: {title, excerpt, body, ...}, es?: {...}, ar?: {...} }
    translations: {
      type: Map,
      of: mongoose.Schema.Types.Mixed,
      default: {},
    },

    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "GestionAmpUser",
      default: null,
    },
  },
  { timestamps: true }
);

module.exports = function getArticleModel() {
  const formDB = global.formDB;

  if (!formDB) {
    throw new Error("❌ formDB non initialisée (Article)");
  }

  return formDB.models.CmsArticle || formDB.model("CmsArticle", ArticleSchema);
};
