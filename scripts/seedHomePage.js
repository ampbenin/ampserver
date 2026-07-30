/**
 * Script : migration ponctuelle du contenu éditable de l'accueil
 * (slides du hero + chiffres clés) vers la collection CMS `CmsPage`
 * (document pageKey: "home"). À exécuter une seule fois :
 *
 *   node scripts/seedHomePage.js
 *
 * Ne couvre que le contenu réellement codé en dur (slides du hero + valeurs
 * chiffrées) — les libellés/icônes des stats restent gérés par le système
 * i18n existant (voir plan de refonte, décision utilisateur du 2026-07-24).
 */

require("dotenv").config();
const connectDB = require("../config/db");
const getCmsPageModel = require("../models/cms/CmsPage");

const HOME_ZONES = {
  heroSlides: [
    {
      image: "https://res.cloudinary.com/diongmuh8/image/upload/f_auto,q_auto:good,w_1920/v1780903891/ong-site/images/impact-positif-ODD.webp",
      title: "Environnement, Climat et Promotion des ODD",
      subtitle: "Ensemble, promouvons les Objectifs de Développement Durable.",
    },
    {
      image: "https://res.cloudinary.com/diongmuh8/image/upload/f_auto,q_auto:good,w_1920/v1780903892/ong-site/images/forum-jeunesse.webp",
      title: "Engagement, Cohésion Sociale et Droits Humains",
      subtitle: "Accompagnons les jeunes et communautés vers un avenir meilleur sans inégalités sociales et violences.",
    },
    {
      image: "https://res.cloudinary.com/diongmuh8/image/upload/f_auto,q_auto:good,w_1920/v1780903892/ong-site/images/innovation.webp",
      title: "Innovation, Entrepreneuriat Social et Numérique",
      subtitle: "Soutenons les projets transformateurs dans nos communautés.",
    },
    {
      image: "https://res.cloudinary.com/diongmuh8/image/upload/f_auto,q_auto:good,w_1920/v1780903894/ong-site/images/sante-bienetre-social.webp",
      title: "Éducation, Santé et Promotion de l'Enfance",
      subtitle: "Nous intervenons dans les domaines de l'Éducation, Santé communautaire et la Promotion de l'Enfance.",
    },
  ],
  heroStats: [
    { value: "7 000+" },
    { value: "20" },
    { value: "12" },
  ],
  parallaxStats: [
    { value: 1 },
    { value: 12 },
    { value: 20 },
    { value: 7000 },
  ],
};

async function seed() {
  try {
    await connectDB();
    const CmsPage = getCmsPageModel();

    await CmsPage.findOneAndUpdate(
      { pageKey: "home" },
      { pageKey: "home", zones: HOME_ZONES, status: "PUBLISHED" },
      { upsert: true }
    );

    console.log("✅ Page d'accueil migrée (CmsPage 'home')");
    process.exit(0);
  } catch (err) {
    console.error("❌ ERREUR SEED HOME PAGE :", err);
    process.exit(1);
  }
}

seed();
