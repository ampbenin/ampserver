// models/volunteer.js

const mongoose = require("mongoose");

const VolunteerSchema = new mongoose.Schema(
  {
    nom: { type: String, required: true, trim: true },
    prenom: { type: String, required: true, trim: true },
    fullName: { type: String, trim: true }, // généré automatiquement

    email: { type: String, required: true, trim: true },
    telephone: { type: String },

    statut: {
      type: String,
      enum: ["Non disponible", "Refusé", "Mission validée"],
      default: "Non disponible",
    },

    // ✅ Tableau des programmes pour gérer plusieurs programmes de
    // volontariat. `programId` référence VolunteerProgram — une référence
    // inter-connexion (Volunteer vit sur la connexion par défaut,
    // VolunteerProgram sur formDB), même limite déjà acceptée aujourd'hui
    // pour VolunteerForm.handledBy → GestionAmpUser : pas de .populate()
    // automatique, il faut résoudre le nom du programme séparément si
    // besoin. Alimenté automatiquement à l'acceptation d'une candidature
    // (voir volunteerApplicationController.acceptApplication), plus
    // manuellement via SaveVolunteers.jsx.
    programs: [
      {
        programId: { type: mongoose.Schema.Types.ObjectId, required: true },
        statut: {
          type: String,
          enum: ["Non disponible", "Refusé", "Mission validée"],
          default: "Non disponible",
        },
        assignedAt: { type: Date, default: Date.now },
      },
    ],

    // ✅ Stockage cloud des attestations
    attestations: [
      {
        programId: { type: mongoose.Schema.Types.ObjectId, required: true },
        programName: { type: String },
        fileName: { type: String },
        fileUrl: { type: String },
        statut: {
          type: String,
          enum: ["Non disponible", "Refusé", "Mission validée"],
          default: "Non disponible",
        },
        uploadedAt: { type: Date, default: Date.now },
      },
    ],
  },
  { timestamps: true }
);

// Générer fullName automatiquement avant sauvegarde
VolunteerSchema.pre("save", function (next) {
  this.fullName = `${this.nom} ${this.prenom}`;
  next();
});

// Recalcule fullName sur findOneAndUpdate
VolunteerSchema.pre("findOneAndUpdate", async function (next) {
  const update = this.getUpdate() || {};
  if (update.nom || update.prenom) {
    const doc = await this.model.findOne(this.getQuery()).select("nom prenom");
    const newNom = update.nom ?? doc.nom;
    const newPrenom = update.prenom ?? doc.prenom;
    update.fullName = `${newNom} ${newPrenom}`.trim();
    this.setUpdate(update);
  }
  next();
});

// 🔹 Index unique sur email uniquement (un volontaire par email)
VolunteerSchema.index({ email: 1 }, { unique: true });

module.exports = mongoose.models.Volunteer || mongoose.model("Volunteer", VolunteerSchema);
