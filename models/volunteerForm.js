const mongoose = require("mongoose");

const VolunteerFormSchema = new mongoose.Schema({
  fullName: { type: String, required: true },
  birthDate: { type: Date, required: true },
  gender: { type: String, required: true },
  otherGender: { type: String },
  country: { type: String, required: true },
  otherCountry: { type: String },
  city: { type: String, required: true },
  phone: { type: String, required: true },
  email: { type: String, required: true },
  mainSkill: { type: String, required: true },
  sensitiveTopic: { type: String, required: true },
  otherTopic: { type: String },
  desiredDomain: { type: String, required: true },
  otherDomain: { type: String },
  motivation: { type: String, required: true },
  availability: { type: String, required: true },
  agreement: { type: Boolean, required: true },
  createdAt: { type: Date, default: Date.now },
});

// Vérifie si le modèle existe déjà pour éviter les erreurs lors du hot reload
const VolunteerForm = mongoose.models.VolunteerForm || mongoose.model("VolunteerForm", VolunteerFormSchema);

module.exports = VolunteerForm;
