const mongoose = require("mongoose");
const VolunteerForm = require("../models/volunteerForm");

// Connexion à la base MONGODB_URI_FORM
const connectFormDB = async () => {
  if (!global.formDB) {
    global.formDB = await mongoose.createConnection(process.env.MONGODB_URI_FORM, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
  }
  return global.formDB;
};

const saveVolunteerForm = async (req, res) => {
  try {
    await connectFormDB();

    const newVolunteer = new VolunteerForm({
      ...req.body,
      agreement: req.body.agreement === "true" || req.body.agreement === true,
    });

    await newVolunteer.save();

    res.status(201).json({ result: "success", message: "Formulaire envoyé avec succès !" });
  } catch (error) {
    console.error("Erreur saveVolunteerForm:", error);
    res.status(500).json({ result: "error", error: "Impossible d'enregistrer le formulaire" });
  }
};

module.exports = { saveVolunteerForm };
