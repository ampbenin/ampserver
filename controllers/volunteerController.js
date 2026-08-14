// controllers/volunteerController.js
// Fichier des volontaires (profil persistant à travers plusieurs
// programmes) — évolué pour référencer VolunteerProgram au lieu de
// l'ancien Mission. VolunteerProgram vit sur global.formDB (comme NumSAL),
// Volunteer reste sur la connexion par défaut : `.populate()` Mongoose ne
// fonctionne pas entre deux connexions différentes, donc les titres de
// programme sont résolus manuellement (voir attachProgramTitles) au lieu
// d'un populate("programs.programId", "title") qui échouerait
// silencieusement.

const mongoose = require("mongoose");
const Volunteer = require("../models/volunteer");
const getVolunteerProgramModel = require("../models/volunteerProgram");

/* Résout le titre de chaque programme référencé dans programs[]/
   attestations[] d'une liste de volontaires, en une seule requête groupée
   (pas un populate cross-connection). */
const attachProgramTitles = async (volunteers) => {
  const Program = getVolunteerProgramModel();
  const ids = new Set();
  volunteers.forEach((v) => {
    (v.programs || []).forEach((p) => p.programId && ids.add(String(p.programId)));
    (v.attestations || []).forEach((a) => a.programId && ids.add(String(a.programId)));
  });
  const titleById = new Map();
  if (ids.size > 0) {
    const programs = await Program.find({ _id: { $in: [...ids] } }).select("title");
    programs.forEach((p) => titleById.set(String(p._id), p.title));
  }

  return volunteers.map((v) => {
    const obj = v.toObject ? v.toObject() : v;
    obj.programs = (obj.programs || []).map((p) => ({
      ...p,
      programTitle: titleById.get(String(p.programId)) || null,
    }));
    obj.attestations = (obj.attestations || []).map((a) => ({
      ...a,
      programTitle: a.programName || titleById.get(String(a.programId)) || null,
    }));
    return obj;
  });
};

/* ---------------------- Créer ou mettre à jour un volontaire ---------------------- */
const createOrUpdateVolunteer = async (req, res, next) => {
  try {
    const { nom, prenom, email, telephone, statut, dateNaissance, programs = [] } = req.body;
    const Program = getVolunteerProgramModel();

    if (!email) return res.status(400).json({ message: "Email requis" });

    let volunteer = await Volunteer.findOne({ email });

    const programEntries = [];
    for (const p of programs) {
      const program = await Program.findById(p.programId);
      if (program) {
        programEntries.push({
          programId: program._id,
          statut: p.statut || "Non disponible",
        });
      }
    }

    if (!volunteer) {
      volunteer = await Volunteer.create({
        nom,
        prenom,
        email,
        telephone,
        statut,
        dateNaissance: dateNaissance || null,
        programs: programEntries,
      });

      const [populated] = await attachProgramTitles([volunteer]);
      return res.status(201).json({
        success: true,
        message: "Volontaire créé avec succès",
        volunteer: populated,
      });
    }

    volunteer.nom = nom ?? volunteer.nom;
    volunteer.prenom = prenom ?? volunteer.prenom;
    volunteer.telephone = telephone ?? volunteer.telephone;
    volunteer.statut = statut ?? volunteer.statut;
    if (dateNaissance !== undefined) volunteer.dateNaissance = dateNaissance || null;

    for (const p of programEntries) {
      const existing = volunteer.programs.find(
        (vp) => vp.programId.toString() === p.programId.toString()
      );
      if (existing) {
        existing.statut = p.statut;
      } else {
        volunteer.programs.push(p);
      }
    }

    await volunteer.save();

    const [populated] = await attachProgramTitles([volunteer]);
    res.json({
      success: true,
      message: "Volontaire mis à jour avec les programmes",
      volunteer: populated,
    });
  } catch (error) {
    if (error.code === 11000) {
      return res
        .status(400)
        .json({ message: "Ce volontaire existe déjà pour ce programme." });
    }
    next(error);
  }
};

/* ---------------------- Récupérer les volontaires pour certificat ---------------------- */
const fetchVolunteersForCertificate = async (req, res, next) => {
  try {
    const { titre, email } = req.body;
    const Program = getVolunteerProgramModel();

    const program = await Program.findOne({ title: titre });
    if (!program) {
      return res.status(404).json({ success: false, message: "Programme non trouvé" });
    }

    const volunteers = await Volunteer.find({
      "programs.programId": program._id,
      "programs.statut": "Mission validée",
      ...(email && { email }),
    });

    res.json({ success: true, volunteers: await attachProgramTitles(volunteers) });
  } catch (error) {
    next(error);
  }
};

/* ---------------------- Lister les volontaires ---------------------- */
const listVolunteers = async (req, res, next) => {
  try {
    const { search = "", statut, programId, programTitre, sort = "-createdAt" } = req.query;
    const Program = getVolunteerProgramModel();
    const q = {};

    if (search) {
      const rx = new RegExp(search.trim(), "i");
      q.$or = [{ nom: rx }, { prenom: rx }, { email: rx }, { fullName: rx }];
    }

    if (statut) q.statut = statut;

    if (programId && mongoose.isValidObjectId(programId)) {
      q["programs.programId"] = programId;
    } else if (programTitre) {
      const p = await Program.findOne({ title: programTitre }).select("_id");
      if (p) q["programs.programId"] = p._id;
    }

    const items = await Volunteer.find(q).sort(sort);

    res.json({ success: true, total: items.length, items: await attachProgramTitles(items) });
  } catch (error) {
    next(error);
  }
};

/* ---------------------- Détail d'un volontaire ---------------------- */
const getVolunteerById = async (req, res, next) => {
  try {
    const v = await Volunteer.findById(req.params.id);
    if (!v) return res.status(404).json({ message: "Volontaire non trouvé" });
    const [populated] = await attachProgramTitles([v]);
    res.json({ success: true, volunteer: populated });
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

/* ---------------------- Attribuer des programmes supplémentaires ---------------------- */
const assignVolunteerMissions = async (req, res, next) => {
  try {
    const { missions: programTitles = [] } = req.body;
    const Program = getVolunteerProgramModel();
    const volunteer = await Volunteer.findById(req.params.id);
    if (!volunteer) return res.status(404).json({ message: "Volontaire non trouvé" });

    const newEntries = [];
    for (const titre of programTitles) {
      const program = await Program.findOne({ title: titre });
      if (program && !volunteer.programs.find((p) => p.programId.toString() === program._id.toString())) {
        newEntries.push({ programId: program._id });
      }
    }

    if (newEntries.length === 0) {
      return res.status(400).json({ message: "Aucun nouveau programme à attribuer" });
    }

    volunteer.programs = [...volunteer.programs, ...newEntries];
    await volunteer.save();

    const [populated] = await attachProgramTitles([volunteer]);
    res.json({ success: true, volunteer: populated, message: "Programmes attribués" });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createOrUpdateVolunteer,
  fetchVolunteersForCertificate,
  listVolunteers,
  getVolunteerById,
  deleteVolunteer,
  assignVolunteerMissions,
  // Réutilisé par controllers/volunteerAuthController.js (résolution des
  // titres de programme pour la fiche "Mon espace" d'un volontaire connecté).
  attachProgramTitles,
};
