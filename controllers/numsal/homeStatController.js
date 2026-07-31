/**
 * Contrôleur Statistiques page d'accueil — Plateforme NumSAL
 * Lecture publique (section chiffres-clés de la page d'accueil) + gestion
 * réservée à l'ADMIN (créer, modifier, supprimer, réordonner) — même schéma
 * que le module Partenaires.
 */

const Sentry = require("@sentry/node");
const getNumsalHomeStatModel = require("../../models/numsal/NumsalHomeStat");

/* -------------------- Public : liste des statistiques -------------------- */
exports.listHomeStats = async (req, res, next) => {
  try {
    const HomeStat = getNumsalHomeStatModel();
    const stats = await HomeStat.find().sort({ order: 1, createdAt: 1 });
    res.json({ items: stats });
  } catch (error) {
    next(error);
  }
};

/* -------------------- ADMIN : créer une statistique -------------------- */
exports.createHomeStat = async (req, res) => {
  try {
    const HomeStat = getNumsalHomeStatModel();
    const { label, value, icon } = req.body;

    if (!label || !value) return res.status(400).json({ message: "Le libellé et la valeur sont requis" });

    const last = await HomeStat.findOne().sort({ order: -1 });
    const order = last ? last.order + 1 : 0;

    const stat = await HomeStat.create({ label, value, icon: icon || "", order });
    res.status(201).json(stat);
  } catch (error) {
    Sentry.captureException(error);
    res.status(500).json({ message: "Erreur serveur", error: error.message });
  }
};

/* -------------------- ADMIN : modifier une statistique -------------------- */
exports.updateHomeStat = async (req, res) => {
  try {
    const HomeStat = getNumsalHomeStatModel();
    const stat = await HomeStat.findById(req.params.id);
    if (!stat) return res.status(404).json({ message: "Statistique introuvable" });

    const { label, value, icon } = req.body;
    if (label !== undefined) stat.label = label;
    if (value !== undefined) stat.value = value;
    if (icon !== undefined) stat.icon = icon;

    await stat.save();
    res.json(stat);
  } catch (error) {
    Sentry.captureException(error);
    res.status(500).json({ message: "Erreur serveur", error: error.message });
  }
};

/* -------------------- ADMIN : supprimer une statistique -------------------- */
exports.deleteHomeStat = async (req, res) => {
  try {
    const HomeStat = getNumsalHomeStatModel();
    const stat = await HomeStat.findById(req.params.id);
    if (!stat) return res.status(404).json({ message: "Statistique introuvable" });

    await stat.deleteOne();
    res.json({ message: "Statistique supprimée avec succès" });
  } catch (error) {
    Sentry.captureException(error);
    res.status(500).json({ message: "Erreur serveur", error: error.message });
  }
};

/* -------------------- ADMIN : réordonner les statistiques -------------------- */
exports.reorderHomeStats = async (req, res) => {
  try {
    const HomeStat = getNumsalHomeStatModel();
    const { statIds } = req.body;

    const total = await HomeStat.countDocuments();
    if (!Array.isArray(statIds) || statIds.length !== total) {
      return res.status(400).json({ message: "statIds doit contenir exactement toutes les statistiques" });
    }

    await Promise.all(
      statIds.map((id, index) => HomeStat.updateOne({ _id: id }, { order: index }))
    );

    const stats = await HomeStat.find().sort({ order: 1 });
    res.json({ items: stats });
  } catch (error) {
    Sentry.captureException(error);
    res.status(500).json({ message: "Erreur serveur", error: error.message });
  }
};
