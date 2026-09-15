/**
 * Contrôleur Personnel — Base du personnel AMP BÉNIN
 * Alimentée automatiquement par jobApplicationController.js#retainApplication
 * (candidature retenue), ou en ajout manuel (personnel déjà en poste, non
 * issu d'un recrutement).
 */

const getPersonnelModel = require("../models/personnel");

exports.listPersonnel = async (req, res, next) => {
  try {
    const { category, status, search } = req.query;
    const query = {};
    if (category) query.category = category;
    if (status) query.status = status;

    if (search?.trim()) {
      const regex = new RegExp(search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      query.$or = [
        { firstName: regex },
        { lastName: regex },
        { email: regex },
        { phone: regex },
      ];
    }

    const Personnel = getPersonnelModel();
    const items = await Personnel.find(query).sort({ createdAt: -1 });
    res.json({ items });
  } catch (error) {
    next(error);
  }
};

exports.listCategories = async (req, res, next) => {
  try {
    const Personnel = getPersonnelModel();
    const categories = await Personnel.distinct("category");
    res.json({ categories: categories.filter(Boolean).sort() });
  } catch (error) {
    next(error);
  }
};

exports.createPersonnel = async (req, res, next) => {
  try {
    const { firstName, lastName, email, phone, category, status, hiredAt, notes } = req.body;
    if (!firstName || !lastName || !email || !category) {
      return res.status(400).json({ message: "Prénom, nom, email et catégorie requis" });
    }

    const Personnel = getPersonnelModel();
    const item = await Personnel.create({
      firstName, lastName, email, phone: phone || "",
      category, status: status || "ACTIF",
      hiredAt: hiredAt || undefined,
      notes: notes || "",
      createdBy: req.user.id,
    });
    res.status(201).json(item);
  } catch (error) {
    next(error);
  }
};

exports.updatePersonnel = async (req, res, next) => {
  try {
    const Personnel = getPersonnelModel();
    const { firstName, lastName, email, phone, category, status, hiredAt, notes } = req.body;
    const item = await Personnel.findByIdAndUpdate(
      req.params.id,
      { firstName, lastName, email, phone, category, status, hiredAt, notes },
      { new: true, runValidators: true }
    );
    if (!item) return res.status(404).json({ message: "Membre du personnel introuvable" });
    res.json(item);
  } catch (error) {
    next(error);
  }
};

exports.deletePersonnel = async (req, res, next) => {
  try {
    const Personnel = getPersonnelModel();
    const deleted = await Personnel.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ message: "Membre du personnel introuvable" });
    res.json({ success: true, message: "Membre du personnel supprimé" });
  } catch (error) {
    next(error);
  }
};
