/**
 * Modèle Institution – CMS AMP BENIN (DB2)
 * Migration directe de src/data/is.js (IS_LIST) vers Mongo.
 */

const mongoose = require("mongoose");

const InstitutionSchema = new mongoose.Schema(
  {
    slug: { type: String, required: true, unique: true, trim: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, default: "" },
    image: { type: String, default: "" },
    missions: { type: [String], default: [] },
    order: { type: Number, default: 0 },

    status: {
      type: String,
      enum: ["DRAFT", "PUBLISHED"],
      default: "DRAFT",
    },

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

module.exports = function getInstitutionCmsModel() {
  const formDB = global.formDB;

  if (!formDB) {
    throw new Error("❌ formDB non initialisée (Institution CMS)");
  }

  return (
    formDB.models.CmsInstitution || formDB.model("CmsInstitution", InstitutionSchema)
  );
};
