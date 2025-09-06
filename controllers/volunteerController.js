const Volunteer = require("../models/volunteer");
const Mission = require("../models/mission");

// ➕ Créer un volontaire
const createVolunteer = async (req, res, next) => {
  try {
    const { titre, nom, prenom, email, telephone, statut } = req.body;

    // 🔹 Trouver la mission par son titre
    const mission = await Mission.findOne({ titre });
    if (!mission) {
      return res.status(404).json({ success: false, message: "Mission non trouvée" });
    }

    // 🔹 Créer le volontaire avec l'ObjectId déjà présent
    const volunteer = await Volunteer.create({
      nom,
      prenom,
      email,
      telephone,
      statut,
      mission: mission._id,
    });

    res.status(201).json({ success: true, message: "Volontaire ajouté avec succès", volunteer });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ message: "Ce volontaire existe déjà pour cette mission." });
    }
    next(error);
  }
};

// 📥 Récupérer les volontaires pour une mission donnée
const fetchVolunteersForCertificate = async (req, res, next) => {
  try {
    const { titre, email } = req.body;

    // 🔹 Récupérer l'ID mission depuis son titre
    const mission = await Mission.findOne({ titre });
    if (!mission) {
      return res.status(404).json({ success: false, message: "Mission non trouvée" });
    }

    // ✅ Mission._id est déjà un ObjectId, pas besoin de mongoose.Types.ObjectId()
    const filter = { mission: mission._id, statut: "Mission validée" };
    if (email) filter.email = email;

    const volunteers = await Volunteer.find(filter);

    res.json({ success: true, volunteers });
  } catch (error) {
    next(error);
  }
};

// 📝 Générer les attestations (squelette)
const generateCertificate = async (req, res, next) => {
  try {
    const { volunteers } = req.body;

    // Ici on fera la génération du PDF + upload (ex: Cloudinary)
    // Pour l’instant on simule juste :
    const generated = volunteers.length;

    res.json({ message: "Attestations générées", generated });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createVolunteer,
  fetchVolunteersForCertificate,
  generateCertificate,
};
