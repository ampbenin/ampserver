/**
 * Contrôleur Partenaires — Plateforme NumSAL
 * Lecture publique (page /partenaires) + gestion réservée à l'ADMIN
 * (création, modification, suppression, réordonnancement).
 */

const Sentry = require("@sentry/node");
const getNumsalPartnerModel = require("../../models/numsal/NumsalPartner");

/* -------------------- Public : liste des partenaires -------------------- */
exports.listPartners = async (req, res, next) => {
  try {
    const Partner = getNumsalPartnerModel();
    const partners = await Partner.find().sort({ order: 1, createdAt: 1 });
    res.json({ items: partners });
  } catch (error) {
    next(error);
  }
};

/* -------------------- ADMIN : créer un partenaire -------------------- */
exports.createPartner = async (req, res) => {
  try {
    const Partner = getNumsalPartnerModel();
    const { name, description, logoUrl, websiteUrl } = req.body;

    if (!name) return res.status(400).json({ message: "Le nom du partenaire est requis" });

    const lastPartner = await Partner.findOne().sort({ order: -1 });
    const order = lastPartner ? lastPartner.order + 1 : 0;

    const partner = await Partner.create({
      name,
      description: description || "",
      logoUrl: logoUrl || "",
      websiteUrl: websiteUrl || "",
      order,
    });

    res.status(201).json(partner);
  } catch (error) {
    Sentry.captureException(error);
    res.status(500).json({ message: "Erreur serveur", error: error.message });
  }
};

/* -------------------- ADMIN : modifier un partenaire -------------------- */
exports.updatePartner = async (req, res) => {
  try {
    const Partner = getNumsalPartnerModel();
    const partner = await Partner.findById(req.params.id);
    if (!partner) return res.status(404).json({ message: "Partenaire introuvable" });

    const { name, description, logoUrl, websiteUrl } = req.body;
    if (name !== undefined) partner.name = name;
    if (description !== undefined) partner.description = description;
    if (logoUrl !== undefined) partner.logoUrl = logoUrl;
    if (websiteUrl !== undefined) partner.websiteUrl = websiteUrl;

    await partner.save();
    res.json(partner);
  } catch (error) {
    Sentry.captureException(error);
    res.status(500).json({ message: "Erreur serveur", error: error.message });
  }
};

/* -------------------- ADMIN : supprimer un partenaire -------------------- */
exports.deletePartner = async (req, res) => {
  try {
    const Partner = getNumsalPartnerModel();
    const partner = await Partner.findById(req.params.id);
    if (!partner) return res.status(404).json({ message: "Partenaire introuvable" });

    await partner.deleteOne();
    res.json({ message: "Partenaire supprimé avec succès" });
  } catch (error) {
    Sentry.captureException(error);
    res.status(500).json({ message: "Erreur serveur", error: error.message });
  }
};

/* -------------------- ADMIN : réordonner les partenaires -------------------- */
/* Body: { partnerIds: ["<id dans le nouvel ordre>", ...] } — doit contenir
   exactement tous les partenaires existants, comme reorderLessons. */
exports.reorderPartners = async (req, res) => {
  try {
    const Partner = getNumsalPartnerModel();
    const { partnerIds } = req.body;

    const total = await Partner.countDocuments();
    if (!Array.isArray(partnerIds) || partnerIds.length !== total) {
      return res.status(400).json({ message: "partnerIds doit contenir exactement tous les partenaires" });
    }

    await Promise.all(
      partnerIds.map((id, index) => Partner.updateOne({ _id: id }, { order: index }))
    );

    const partners = await Partner.find().sort({ order: 1 });
    res.json({ items: partners });
  } catch (error) {
    Sentry.captureException(error);
    res.status(500).json({ message: "Erreur serveur", error: error.message });
  }
};
