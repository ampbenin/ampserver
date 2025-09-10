// controllers/volunteerController.js

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



/* ---------------------- contrôleurs CRUD VolunteersManager ---------------------- */

/* 🔎 Lister + rechercher + filtrer (sans pagination)
   GET /api/volunteers?search=&statut=&missionId=&missionTitre */
const listVolunteers = async (req, res, next) => {
  try {
    const { search = "", statut, missionId, missionTitre, sort = "-createdAt" } = req.query;

    const q = {};

    if (search) {
      const rx = new RegExp(search.trim(), "i");
      q.$or = [{ nom: rx }, { prenom: rx }, { email: rx }, { fullName: rx }];
    }

    if (statut) q.statut = statut;

    if (missionId && mongoose.isValidObjectId(missionId)) {
      q.mission = missionId;
    } else if (missionTitre) {
      const m = await Mission.findOne({ titre: missionTitre }).select("_id");
      if (m) q.mission = m._id;
      else q.mission = null;
    }

    const items = await Volunteer.find(q)
      .populate("mission", "titre")
      .sort(sort);

    res.json({
      success: true,
      total: items.length,
      items,
    });
  } catch (error) {
    next(error);
  }
};


/* 📄 Détail d’un volontaire
   GET /api/volunteers/:id */
const getVolunteerById = async (req, res, next) => {
  try {
    const v = await Volunteer.findById(req.params.id).populate("mission", "titre");
    if (!v) return res.status(404).json({ message: "Volontaire non trouvé" });
    res.json({ success: true, volunteer: v });
  } catch (error) {
    next(error);
  }
};

/* ✏️ Mettre à jour un volontaire
   PUT /api/volunteers/:id */
const updateVolunteer = async (req, res, next) => {
  try {
    const { nom, prenom, email, telephone, statut, missionId, missionTitre } = req.body;

    let mission;
    if (missionId && mongoose.isValidObjectId(missionId)) {
      mission = await Mission.findById(missionId);
      if (!mission) return res.status(404).json({ message: "Mission non trouvée" });
    } else if (missionTitre) {
      mission = await Mission.findOne({ titre: missionTitre });
      if (!mission) return res.status(404).json({ message: "Mission non trouvée" });
    }

    const updates = {};
    if (typeof nom === "string") updates.nom = nom.trim();
    if (typeof prenom === "string") updates.prenom = prenom.trim();
    if (typeof email === "string") updates.email = email.trim();
    if (typeof telephone === "string") updates.telephone = telephone.trim();
    if (typeof statut === "string") updates.statut = statut;
    if (mission) updates.mission = mission._id;

    if ("nom" in updates || "prenom" in updates) {
      const current = await Volunteer.findById(req.params.id).select("nom prenom");
      if (!current) return res.status(404).json({ message: "Volontaire non trouvé" });
      const newNom = updates.nom ?? current.nom;
      const newPrenom = updates.prenom ?? current.prenom;
      updates.fullName = `${newNom} ${newPrenom}`.trim();
    }

    const updated = await Volunteer.findByIdAndUpdate(req.params.id, updates, {
      new: true,
      runValidators: true,
    }).populate("mission", "titre");

    if (!updated) return res.status(404).json({ message: "Volontaire non trouvé" });
    res.json({ success: true, volunteer: updated });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ message: "Ce volontaire existe déjà pour cette mission." });
    }
    next(error);
  }
};

/* 🗑️ Supprimer un volontaire
   DELETE /api/volunteers/:id */
const deleteVolunteer = async (req, res, next) => {
  try {
    const deleted = await Volunteer.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ message: "Volontaire non trouvé" });
    res.json({ success: true, message: "Volontaire supprimé" });
  } catch (error) {
    next(error);
  }
};

/* 🎯 Attribuer / ré-attribuer une mission
   POST /api/volunteers/:id/assign-mission
   Body: { missionId?, missionTitre? } */
const assignVolunteerMission = async (req, res, next) => {
  try {
    const { missionId, missionTitre } = req.body;

    let mission;
    if (missionId && mongoose.isValidObjectId(missionId)) {
      mission = await Mission.findById(missionId);
    } else if (missionTitre) {
      mission = await Mission.findOne({ titre: missionTitre });
    }
    if (!mission) return res.status(404).json({ message: "Mission non trouvée" });

    const volunteer = await Volunteer.findById(req.params.id);
    if (!volunteer) return res.status(404).json({ message: "Volontaire non trouvé" });

    // Vérifie si la mission est déjà attribuée
    if (volunteer.mission && volunteer.mission.toString() === mission._id.toString()) {
      return res.status(400).json({ message: "Ce volontaire dispose déjà de cette mission." });
    }

    volunteer.mission = mission._id;
    await volunteer.save();

    const populated = await Volunteer.findById(volunteer._id).populate("mission", "titre");
    res.json({ success: true, volunteer: populated, message: "Mission attribuée" });
  } catch (error) {
    next(error);
  }
};


module.exports = {
  createVolunteer,
  fetchVolunteersForCertificate,
  listVolunteers,
  getVolunteerById,
  updateVolunteer,
  deleteVolunteer,
  assignVolunteerMission,
};
