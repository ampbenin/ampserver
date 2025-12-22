const getContactFormModel = require('../../models/ContactForm');

exports.getAll = async (req, res) => {
  try {
    const Contact = getContactFormModel(); // ⚡ Appelle la fonction pour récupérer le modèle
    console.log("🔥 getAll contacts appelé");
    const list = await Contact.find().sort({ createdAt: -1 });
    res.json(list);
  } catch (err) {
    console.error("❌ ERREUR getAll contacts :", err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

exports.delete = async (req, res) => {
  try {
    const Contact = getContactFormModel();
    await Contact.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    console.error("❌ ERREUR delete contact :", err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

exports.markHandled = async (req, res) => {
  try {
    const Contact = getContactFormModel();
    await Contact.findByIdAndUpdate(req.params.id, { handled: true });
    res.json({ ok: true });
  } catch (err) {
    console.error("❌ ERREUR markHandled contact :", err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
};
