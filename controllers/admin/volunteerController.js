// controllers/admin/volunteerController.js
const VolunteerForm = require('../../models/volunteerForm');
const Volunteer = require('../../models/volunteer');

exports.getAll = async (req, res) => {
  try {
    const { page = 1, limit = 25 } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const [items, total] = await Promise.all([
      VolunteerForm.find().sort({ createdAt: -1 }).skip(skip).limit(Number(limit)),
      VolunteerForm.countDocuments(),
    ]);

    res.json({ items, total, page: Number(page), limit: Number(limit) });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

exports.approve = async (req, res) => {
  try {
    const updated = await VolunteerForm.findByIdAndUpdate(
      req.params.id,
      { status: 'approved', handledBy: req.user.id, handledAt: new Date() },
      { new: true }
    );
    res.json({ ok: true, volunteer: updated });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

exports.delete = async (req, res) => {
  try {
    await VolunteerForm.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

/**
 * Pont de promotion : transforme une candidature de volontariat
 * (VolunteerForm, formulaire public) en volontaire éligible aux missions
 * (Volunteer, utilisé par le pipeline missions/certificats). Action manuelle
 * et explicite — jamais automatique — voir plan de refonte phase 2.
 */
exports.promote = async (req, res) => {
  try {
    const form = await VolunteerForm.findById(req.params.id);
    if (!form) return res.status(404).json({ error: 'Candidature non trouvée' });

    if (form.promotedTo) {
      return res.status(409).json({ error: 'Cette candidature a déjà été promue' });
    }

    const [nom, ...rest] = form.fullName.trim().split(' ');
    const prenom = rest.join(' ') || nom;

    let volunteer = await Volunteer.findOne({ email: form.email });
    if (!volunteer) {
      volunteer = await Volunteer.create({
        nom,
        prenom,
        email: form.email,
        telephone: form.phone,
      });
    }

    form.promotedTo = volunteer._id;
    form.status = 'approved';
    form.handledBy = req.user.id;
    form.handledAt = new Date();
    await form.save();

    res.json({ ok: true, volunteer });
  } catch (err) {
    console.error('❌ ERREUR promote volunteer :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
};
