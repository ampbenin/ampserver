// controllers/admin/partnerController.js
const Partner = require('../../models/Partner');

exports.getAll = async (req, res) => {
  try {
    const { page = 1, limit = 25 } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const [items, total] = await Promise.all([
      Partner.find().sort({ createdAt: -1 }).skip(skip).limit(Number(limit)),
      Partner.countDocuments(),
    ]);

    res.json({ items, total, page: Number(page), limit: Number(limit) });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

exports.approve = async (req, res) => {
  try {
    const updated = await Partner.findByIdAndUpdate(
      req.params.id,
      { status: 'approved', handledBy: req.user.id, handledAt: new Date() },
      { new: true }
    );
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
