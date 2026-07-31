/**
 * Contrôleur Témoignages — Plateforme NumSAL
 * Soumission publique ("Donner votre avis" sur la page d'accueil) +
 * modération réservée à l'ADMIN (publier/rejeter/réordonner/supprimer).
 * `contact` n'est jamais renvoyé par les routes publiques.
 */

const Sentry = require("@sentry/node");
const getNumsalTestimonialModel = require("../../models/numsal/NumsalTestimonial");

/* -------------------- Public : avis publiés -------------------- */
exports.listPublishedTestimonials = async (req, res, next) => {
  try {
    const Testimonial = getNumsalTestimonialModel();
    const testimonials = await Testimonial.find({ status: "PUBLISHED" })
      .select("fullName photoUrl message order")
      .sort({ order: 1, createdAt: 1 });
    res.json({ items: testimonials });
  } catch (error) {
    next(error);
  }
};

/* -------------------- Public : soumettre un avis (reste en attente de modération) -------------------- */
exports.submitTestimonial = async (req, res) => {
  try {
    const Testimonial = getNumsalTestimonialModel();
    const { fullName, contact, photoUrl, message } = req.body;

    if (!fullName || !contact || !message) {
      return res.status(400).json({ message: "Nom complet, contact et avis sont requis" });
    }

    await Testimonial.create({
      fullName,
      contact,
      photoUrl: photoUrl || "",
      message,
      status: "PENDING",
    });

    res.status(201).json({ message: "Merci ! Votre avis a été envoyé et sera publié après validation." });
  } catch (error) {
    Sentry.captureException(error);
    res.status(500).json({ message: "Erreur serveur", error: error.message });
  }
};

/* -------------------- ADMIN : tous les avis (toutes moderations) -------------------- */
exports.listAllTestimonials = async (req, res) => {
  try {
    const Testimonial = getNumsalTestimonialModel();
    const testimonials = await Testimonial.find().sort({ createdAt: -1 });
    res.json({ items: testimonials });
  } catch (error) {
    Sentry.captureException(error);
    res.status(500).json({ message: "Erreur serveur", error: error.message });
  }
};

/* -------------------- ADMIN : publier un avis -------------------- */
exports.publishTestimonial = async (req, res) => {
  try {
    const Testimonial = getNumsalTestimonialModel();
    const testimonial = await Testimonial.findById(req.params.id);
    if (!testimonial) return res.status(404).json({ message: "Avis introuvable" });

    if (testimonial.status !== "PUBLISHED") {
      const last = await Testimonial.findOne({ status: "PUBLISHED" }).sort({ order: -1 });
      testimonial.order = last ? last.order + 1 : 0;
    }
    testimonial.status = "PUBLISHED";
    await testimonial.save();

    res.json(testimonial);
  } catch (error) {
    Sentry.captureException(error);
    res.status(500).json({ message: "Erreur serveur", error: error.message });
  }
};

/* -------------------- ADMIN : rejeter un avis -------------------- */
exports.rejectTestimonial = async (req, res) => {
  try {
    const Testimonial = getNumsalTestimonialModel();
    const testimonial = await Testimonial.findById(req.params.id);
    if (!testimonial) return res.status(404).json({ message: "Avis introuvable" });

    testimonial.status = "REJECTED";
    await testimonial.save();

    res.json(testimonial);
  } catch (error) {
    Sentry.captureException(error);
    res.status(500).json({ message: "Erreur serveur", error: error.message });
  }
};

/* -------------------- ADMIN : supprimer un avis -------------------- */
exports.deleteTestimonial = async (req, res) => {
  try {
    const Testimonial = getNumsalTestimonialModel();
    const testimonial = await Testimonial.findById(req.params.id);
    if (!testimonial) return res.status(404).json({ message: "Avis introuvable" });

    await testimonial.deleteOne();
    res.json({ message: "Avis supprimé avec succès" });
  } catch (error) {
    Sentry.captureException(error);
    res.status(500).json({ message: "Erreur serveur", error: error.message });
  }
};

/* -------------------- ADMIN : réordonner les avis publiés -------------------- */
exports.reorderTestimonials = async (req, res) => {
  try {
    const Testimonial = getNumsalTestimonialModel();
    const { testimonialIds } = req.body;

    const total = await Testimonial.countDocuments({ status: "PUBLISHED" });
    if (!Array.isArray(testimonialIds) || testimonialIds.length !== total) {
      return res.status(400).json({ message: "testimonialIds doit contenir exactement tous les avis publiés" });
    }

    await Promise.all(
      testimonialIds.map((id, index) => Testimonial.updateOne({ _id: id, status: "PUBLISHED" }, { order: index }))
    );

    const testimonials = await Testimonial.find({ status: "PUBLISHED" }).sort({ order: 1 });
    res.json({ items: testimonials });
  } catch (error) {
    Sentry.captureException(error);
    res.status(500).json({ message: "Erreur serveur", error: error.message });
  }
};
