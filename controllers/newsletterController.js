const getNewsletterModel = require("../models/Newsletter");

const subscribeNewsletter = async (req, res) => {
  try {
    const Newsletter = getNewsletterModel(); // ⚡ récupérer le modèle au moment de l'exécution

    const { fullname, email, alert_type } = req.body;

    if (!fullname || !email) {
      return res.status(400).json({ message: "Nom et email sont requis" });
    }

    const existing = await Newsletter.findOne({ email });
    if (existing) {
      return res.status(409).json({ message: "Email déjà inscrit" });
    }

    const subscriber = await Newsletter.create({ fullname, email, alert_type });
    res.status(201).json({ message: "Inscription réussie !", data: subscriber });
  } catch (error) {
    console.error("Erreur newsletter :", error);
    res.status(500).json({ message: error.message || "Erreur serveur" });
  }
};

module.exports = { subscribeNewsletter };
