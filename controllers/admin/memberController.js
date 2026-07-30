// controllers/admin/memberController.js
const Member = require('../../models/Member');

exports.getAll = async (req, res) => {
  try {
    const { page = 1, limit = 25 } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const [items, total] = await Promise.all([
      Member.find().sort({ createdAt: -1 }).skip(skip).limit(Number(limit)),
      Member.countDocuments(),
    ]);

    res.json({ items, total, page: Number(page), limit: Number(limit) });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

exports.approve = async (req, res) => {
  try {
    const id = req.params.id;
    const updated = await Member.findByIdAndUpdate(
      id,
      { status: 'approved', handledBy: req.user.id, handledAt: new Date() },
      { new: true }
    );
    res.json({ ok: true, member: updated });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

exports.delete = async (req, res) => {
  try {
    await Member.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
};
