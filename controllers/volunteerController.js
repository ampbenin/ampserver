// controllers/volunteerController.js

const mongoose = require("mongoose");
const Volunteer = require("../models/volunteer");
const Mission = require("../models/mission");

/* ---------------------- Créer ou mettre à jour un volontaire ---------------------- */
const createOrUpdateVolunteer = async (req, res, next) => {
  try {
    const { nom, prenom, email, telephone, statut, missions = [] } = req.body;

    if (!email) return res.status(400).json({ message: "Email requis" });

    // 🔹 Chercher un volontaire existant par email
    let volunteer = await Volunteer.findOne({ email });

    // 🔹 Préparer les missions avec statut
    const missionEntries = [];
    for (const m of missions) {
      const mission = await Mission.findById(m.missionId);
      if (mission) {
        missionEntries.push({
          missionId: mission._id,
          statut: m.statut || "Non disponible",
        });
      }
    }

    if (!volunteer) {
      // 🔹 Créer un nouveau volontaire
      volunteer = await Volunteer.create({
        nom,
        prenom,
        email,
        telephone,
        statut,
        missions: missionEntries,
      });

      const populated = await Volunteer.findById(volunteer._id).populate(
        "missions.missionId",
        "titre"
      );

      return res.status(201).json({
        success: true,
        message: "Volontaire créé avec succès",
        volunteer: populated,
      });
    }

    // 🔹 Si le volontaire existe, mettre à jour les informations
    volunteer.nom = nom ?? volunteer.nom;
    volunteer.prenom = prenom ?? volunteer.prenom;
    volunteer.telephone = telephone ?? volunteer.telephone;
    volunteer.statut = statut ?? volunteer.statut;

    // 🔹 Ajouter ou mettre à jour les missions
    for (const m of missionEntries) {
      const existing = volunteer.missions.find(
        (vm) => vm.missionId.toString() === m.missionId.toString()
      );
      if (existing) {
        // Mettre à jour le statut si déjà existant
        existing.statut = m.statut;
      } else {
        // Ajouter nouvelle mission
        volunteer.missions.push(m);
      }
    }

    await volunteer.save();

    const populated = await Volunteer.findById(volunteer._id).populate(
      "missions.missionId",
      "titre"
    );

    res.json({
      success: true,
      message: "Volontaire mis à jour avec les missions",
      volunteer: populated,
    });
  } catch (error) {
    if (error.code === 11000) {
      return res
        .status(400)
        .json({ message: "Ce volontaire existe déjà pour cette mission." });
    }
    next(error);
  }
};

/* ---------------------- Autocomplete email volontaire ---------------------- */
const searchVolunteerByEmail = async (req, res, next) => {
  try {
    const { q } = req.query;

    if (!q || q.length < 2) {
      return res.json({ success: true, items: [] });
    }

    const regex = new RegExp(q, "i");

    const volunteers = await Volunteer.find({ email: regex })
      .select("email nom prenom telephone statut")
      .limit(5);

    res.json({ success: true, items: volunteers });
  } catch (error) {
    next(error);
  }
};


/* ---------------------- Récupérer les volontaires pour certificat ---------------------- */
const fetchVolunteersForCertificate = async (req, res, next) => {
  try {
    const { titre, email } = req.body;

    const mission = await Mission.findOne({ titre });
    if (!mission) {
      return res.status(404).json({ success: false, message: "Mission non trouvée" });
    }

    const volunteers = await Volunteer.find({
      "missions.missionId": mission._id,
      "missions.statut": "Mission validée",
      ...(email && { email }),
    }).populate("missions.missionId", "titre");

    res.json({ success: true, volunteers });
  } catch (error) {
    next(error);
  }
};

/* ---------------------- Lister les volontaires ---------------------- */
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
      q["missions.missionId"] = missionId;
    } else if (missionTitre) {
      const m = await Mission.findOne({ titre: missionTitre }).select("_id");
      if (m) q["missions.missionId"] = m._id;
    }

    const items = await Volunteer.find(q).populate("missions.missionId", "titre").sort(sort);

    res.json({ success: true, total: items.length, items });
  } catch (error) {
    next(error);
  }
};

/* ---------------------- Détail d’un volontaire ---------------------- */
const getVolunteerById = async (req, res, next) => {
  try {
    const v = await Volunteer.findById(req.params.id).populate("missions.missionId", "titre");
    if (!v) return res.status(404).json({ message: "Volontaire non trouvé" });
    res.json({ success: true, volunteer: v });
  } catch (error) {
    next(error);
  }
};

/* ---------------------- Supprimer un volontaire ---------------------- */
const deleteVolunteer = async (req, res, next) => {
  try {
    const deleted = await Volunteer.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ message: "Volontaire non trouvé" });
    res.json({ success: true, message: "Volontaire supprimé" });
  } catch (error) {
    next(error);
  }
};

/* ---------------------- Attribuer des missions supplémentaires ---------------------- */
const assignVolunteerMissions = async (req, res, next) => {
  try {
    const { missions = [] } = req.body;
    const volunteer = await Volunteer.findById(req.params.id);
    if (!volunteer) return res.status(404).json({ message: "Volontaire non trouvé" });

    const newMissionIds = [];
    for (const titre of missions) {
      const mission = await Mission.findOne({ titre });
      if (mission && !volunteer.missions.find((m) => m.missionId.toString() === mission._id.toString())) {
        newMissionIds.push({ missionId: mission._id });
      }
    }

    if (newMissionIds.length === 0) {
      return res.status(400).json({ message: "Aucune nouvelle mission à attribuer" });
    }

    volunteer.missions = [...volunteer.missions, ...newMissionIds];
    await volunteer.save();

    const populated = await Volunteer.findById(volunteer._id).populate("missions.missionId", "titre");

    res.json({ success: true, volunteer: populated, message: "Missions attribuées" });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createOrUpdateVolunteer,
  fetchVolunteersForCertificate,
  searchVolunteerByEmail,
  listVolunteers,
  getVolunteerById,
  deleteVolunteer,
  assignVolunteerMissions,
};
