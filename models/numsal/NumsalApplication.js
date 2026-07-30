/**
 * Modèle Application – Plateforme NumSAL
 * Candidature d'une personne (avec ou sans compte NumSAL préalable) à un
 * programme dont l'accès est soumis à admission (accessMode: APPLICATION).
 * Les réponses aux champs personnalisés sont stockées dans `responses`,
 * clés = `id` des champs définis dans NumsalCourse.applicationForm.fields.
 */

const mongoose = require("mongoose");

const NumsalApplicationSchema = new mongoose.Schema(
  {
    courseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "NumsalCourse",
      required: true,
    },
    applicantName: { type: String, required: true, trim: true },
    applicantEmail: { type: String, required: true, lowercase: true, trim: true },
    applicantPhone: { type: String, default: "" },

    responses: {
      type: Map,
      of: mongoose.Schema.Types.Mixed,
      default: {},
    },

    status: {
      type: String,
      enum: ["PENDING", "ACCEPTED", "REJECTED"],
      default: "PENDING",
    },

    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "NumsalUser", default: null },
    reviewedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

NumsalApplicationSchema.index({ courseId: 1, applicantEmail: 1 }, { unique: true });

module.exports = function getNumsalApplicationModel() {
  const formDB = global.formDB;

  if (!formDB) {
    throw new Error("❌ formDB non initialisée (NumsalApplication)");
  }

  return formDB.models.NumsalApplication || formDB.model("NumsalApplication", NumsalApplicationSchema);
};
