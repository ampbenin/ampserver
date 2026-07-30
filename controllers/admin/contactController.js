const getContactFormModel = require('../../models/ContactForm');

exports.getAll = async (req, res) => {
  try {
    const Contact = getContactFormModel();
    const { page = 1, limit = 25 } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const [items, total] = await Promise.all([
      Contact.find().sort({ createdAt: -1 }).skip(skip).limit(Number(limit)),
      Contact.countDocuments(),
    ]);

    res.json({ items, total, page: Number(page), limit: Number(limit) });
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
    await Contact.findByIdAndUpdate(req.params.id, {
      handled: true,
      handledBy: req.user.id,
      handledAt: new Date(),
    });
    res.json({ ok: true });
  } catch (err) {
    console.error("❌ ERREUR markHandled contact :", err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
};
