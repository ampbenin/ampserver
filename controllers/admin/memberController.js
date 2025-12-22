// controllers/admin/memberController.js
const Member = require('../../models/Member');

exports.getAll = async (req, res) => {
  try {
    const items = await Member.find().sort({ createdAt: -1 });
    res.json(items);
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

exports.approve = async (req, res) => {
  try {
    const id = req.params.id;
    const updated = await Member.findByIdAndUpdate(id, { status: 'approved' }, { new: true });
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
