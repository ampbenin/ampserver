/**
 * Contrôleur Modèles de formulaire — Programmes de volontariat AMP Bénin
 * Mirror de controllers/numsal/formTemplateController.js. Réservé au staff
 * (ADMIN/EDITOR) — jamais public.
 */

const getVolunteerFormTemplateModel = require("../models/volunteerFormTemplate");

exports.listTemplates = async (req, res, next) => {
  try {
    const Template = getVolunteerFormTemplateModel();
    const templates = await Template.find().sort({ createdAt: -1 });
    res.json({ items: templates });
  } catch (error) {
    next(error);
  }
};

exports.createTemplate = async (req, res) => {
  try {
    const Template = getVolunteerFormTemplateModel();
    const { name, fields, isSpontaneousDefault } = req.body;

    if (!name) return res.status(400).json({ message: "Le nom du modèle est requis" });
    if (!Array.isArray(fields) || fields.length === 0) {
      return res.status(400).json({ message: "Le modèle doit contenir au moins un champ" });
    }

    // Les champs "système" (prénom/nom/email/téléphone) sont déjà injectés
    // automatiquement dans chaque programme — un modèle ne stocke que les
    // champs personnalisés.
    const customFields = fields.filter((f) => !f.locked);
    if (customFields.length === 0) {
      return res.status(400).json({ message: "Ajoutez au moins un champ personnalisé avant d'enregistrer un modèle" });
    }

    if (isSpontaneousDefault) {
      await Template.updateMany({ isSpontaneousDefault: true }, { isSpontaneousDefault: false });
    }

    const template = await Template.create({ name, fields: customFields, isSpontaneousDefault: !!isSpontaneousDefault });
    res.status(201).json(template);
  } catch (error) {
    res.status(500).json({ message: "Erreur serveur", error: error.message });
  }
};

/* -------------------- ADMIN/EDITOR : marquer comme modèle par défaut des candidatures spontanées -------------------- */
/* Un seul modèle à la fois peut être le modèle spontané — activer celui-ci
   désactive automatiquement tout autre. */
exports.setSpontaneousDefault = async (req, res) => {
  try {
    const Template = getVolunteerFormTemplateModel();
    const template = await Template.findById(req.params.id);
    if (!template) return res.status(404).json({ message: "Modèle introuvable" });

    await Template.updateMany({ isSpontaneousDefault: true }, { isSpontaneousDefault: false });
    template.isSpontaneousDefault = true;
    await template.save();

    res.json(template);
  } catch (error) {
    res.status(500).json({ message: "Erreur serveur", error: error.message });
  }
};

exports.deleteTemplate = async (req, res) => {
  try {
    const Template = getVolunteerFormTemplateModel();
    const template = await Template.findById(req.params.id);
    if (!template) return res.status(404).json({ message: "Modèle introuvable" });

    await template.deleteOne();
    res.json({ message: "Modèle supprimé avec succès" });
  } catch (error) {
    res.status(500).json({ message: "Erreur serveur", error: error.message });
  }
};
