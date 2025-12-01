const getContactFormModel = require("../models/ContactForm");

exports.submitContactForm = async (req, res) => {
  try {
    const ContactForm = getContactFormModel(); // ⚡ Récupère le modèle ici, après init
    const newContact = new ContactForm(req.body);
    await newContact.save();
    res.status(201).json({ success: true, message: "Votre message a été envoyé avec succès !" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Erreur serveur, veuillez réessayer plus tard." });
  }
};
