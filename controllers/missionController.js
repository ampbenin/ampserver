const Mission = require("../models/mission");

// Créer une mission
const createMission = async (req, res, next) => {
  try {
    const mission = new Mission(req.body);
    await mission.save();
    res.status(201).json(mission);
  } catch (error) {
    next(error);
  }
};

// Récupérer toutes les missions
const getMissions = async (req, res, next) => {
  try {
    const missions = await Mission.find();
    res.status(200).json(missions);
  } catch (error) {
    next(error);
  }
};

// Récupérer une mission par ID
const getMissionById = async (req, res, next) => {
  try {
    const mission = await Mission.findById(req.params.id);
    if (!mission) return res.status(404).json({ message: "Mission non trouvée" });
    res.status(200).json(mission);
  } catch (error) {
    next(error);
  }
};

// Mettre à jour une mission
const updateMission = async (req, res, next) => {
  try {
    const mission = await Mission.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!mission) return res.status(404).json({ message: "Mission non trouvée" });
    res.status(200).json(mission);
  } catch (error) {
    next(error);
  }
};

// Supprimer une mission
const deleteMission = async (req, res, next) => {
  try {
    const mission = await Mission.findByIdAndDelete(req.params.id);
    if (!mission) return res.status(404).json({ message: "Mission non trouvée" });
    res.status(200).json({ message: "Mission supprimée avec succès" });
  } catch (error) {
    next(error);
  }
};

// Trouver une mission par son titre
const findMissionByTitle = async (req, res, next) => {
  try {
    const { titre } = req.body;
    if (!titre) return res.status(400).json({ success: false, message: "Le titre est requis" });

    const mission = await Mission.findOne({ titre });
    if (!mission) return res.status(404).json({ success: false, message: "Mission non trouvée" });

    // On renvoie l'ObjectId pour le frontend
    res.status(200).json({ success: true, _id: mission._id, titre: mission.titre });
  } catch (error) {
    console.error(error);
    next(error);
  }
};

module.exports = {
  createMission,
  getMissions,
  getMissionById,
  updateMission,
  deleteMission,
  findMissionByTitle,
};
