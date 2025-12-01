const Partner = require("../models/Partner");

// Enregistrer un partenariat
exports.savePartner = async (req, res) => {
  try {
    const { name, email, location, type, amount, message } = req.body;

    if (!name || !email || !location || !type || !message) {
      return res.status(400).json({ result: "error", error: "Tous les champs requis doivent être remplis" });
    }

    const newPartner = new Partner({
      name,
      email,
      location,
      type,
      amount: amount || 0,
      message
    });

    await newPartner.save();

    return res.status(201).json({ result: "success", message: "Partenariat enregistré avec succès" });
  } catch (err) {
    console.error("Erreur savePartner :", err);
    return res.status(500).json({ result: "error", error: "Erreur serveur, veuillez réessayer" });
  }
};
