/**
 * Contrôleur Modèles de formulaire — Plateforme NumSAL
 * Bibliothèque de formulaires de candidature réutilisables entre
 * programmes : un formateur/admin enregistre le formulaire d'un programme
 * sous un nom, puis n'importe quel autre programme peut l'importer (copie
 * des champs avec de nouveaux identifiants — voir la remarque dans
 * NumsalFormTemplate.js). Réservé aux comptes FORMATEUR/ADMIN (jamais
 * public) : ce ne sont pas des candidatures, mais un outil de productivité
 * pour qui construit des formulaires.
 */

const Sentry = require("@sentry/node");
const getNumsalFormTemplateModel = require("../../models/numsal/NumsalFormTemplate");

exports.listTemplates = async (req, res) => {
  try {
    const Template = getNumsalFormTemplateModel();
    const templates = await Template.find().sort({ createdAt: -1 });
    res.json({ items: templates });
  } catch (error) {
    Sentry.captureException(error);
    res.status(500).json({ message: "Erreur serveur", error: error.message });
  }
};

exports.createTemplate = async (req, res) => {
  try {
    const Template = getNumsalFormTemplateModel();
    const { name, fields } = req.body;

    if (!name) return res.status(400).json({ message: "Le nom du modèle est requis" });
    if (!Array.isArray(fields) || fields.length === 0) {
      return res.status(400).json({ message: "Le modèle doit contenir au moins un champ" });
    }

    // Les champs "système" (nom/email/téléphone) sont déjà injectés
    // automatiquement dans chaque programme — un modèle ne stocke que les
    // champs propres au formulaire, jamais ces trois-là.
    const customFields = fields.filter((f) => !f.locked);
    if (customFields.length === 0) {
      return res.status(400).json({ message: "Ajoutez au moins un champ personnalisé avant d'enregistrer un modèle" });
    }

    const template = await Template.create({ name, fields: customFields });
    res.status(201).json(template);
  } catch (error) {
    Sentry.captureException(error);
    res.status(500).json({ message: "Erreur serveur", error: error.message });
  }
};

exports.deleteTemplate = async (req, res) => {
  try {
    const Template = getNumsalFormTemplateModel();
    const template = await Template.findById(req.params.id);
    if (!template) return res.status(404).json({ message: "Modèle introuvable" });

    await template.deleteOne();
    res.json({ message: "Modèle supprimé avec succès" });
  } catch (error) {
    Sentry.captureException(error);
    res.status(500).json({ message: "Erreur serveur", error: error.message });
  }
};
