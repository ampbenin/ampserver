// controllers/admin/volunteerController.js
const Volunteer = require('../../models/volunteerForm');

exports.getAll = async (req, res) => {
  try {
    const items = await Volunteer.find().sort({ createdAt: -1 });
    res.json(items);
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

exports.approve = async (req, res) => {
  try {
    const updated = await Volunteer.findByIdAndUpdate(req.params.id, { status: 'approved' }, { new: true });
    res.json({ ok: true, volunteer: updated });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

exports.delete = async (req, res) => {
  try {
    await Volunteer.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
};
