// controllers/admin/partnerController.js
const Partner = require('../../models/Partner');

exports.getAll = async (req, res) => {
  try {
    const items = await Partner.find().sort({ createdAt: -1 });
    res.json(items);
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

exports.approve = async (req, res) => {
  try {
    const updated = await Partner.findByIdAndUpdate(req.params.id, { status: 'approved' }, { new: true });
    res.json({ ok: true, partner: updated });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

exports.delete = async (req, res) => {
  try {
    await Partner.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
};
