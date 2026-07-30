/**
 * Modèle Enrollment – Plateforme NumSAL
 * Une inscription d'un apprenant à un cours + les leçons qu'il a
 * cochées comme terminées. Le % de progression se calcule à la lecture
 * (jamais stocké), pour ne pas se désynchroniser si le formateur modifie
 * ses leçons après coup.
 */

const mongoose = require("mongoose");

const NumsalEnrollmentSchema = new mongoose.Schema(
  {
    learnerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "NumsalUser",
      required: true,
    },
    courseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "NumsalCourse",
      required: true,
    },
    enrolledAt: { type: Date, default: Date.now },
    completedLessonIds: { type: [mongoose.Schema.Types.ObjectId], default: [] },
    lastActivityAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

NumsalEnrollmentSchema.index({ learnerId: 1, courseId: 1 }, { unique: true });

module.exports = function getNumsalEnrollmentModel() {
  const formDB = global.formDB;

  if (!formDB) {
    throw new Error("❌ formDB non initialisée (NumsalEnrollment)");
  }

  return formDB.models.NumsalEnrollment || formDB.model("NumsalEnrollment", NumsalEnrollmentSchema);
};
