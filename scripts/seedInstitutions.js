/**
 * Script : migration ponctuelle de src/data/is.js (IS_LIST) vers la
 * collection CMS `Institution` (Mongo). À exécuter une seule fois :
 *
 *   node scripts/seedInstitutions.js
 *
 * Corrige au passage les URL Cloudinary dupliquées présentes dans is.js
 * (ex: ".../ong-sitehttps://res.cloudinary.com/.../ong-site/images/...").
 */

require("dotenv").config();
const connectDB = require("../config/db");
const getInstitutionCmsModel = require("../models/cms/Institution");

// Copie de src/data/is.js (amp-benin-site) — tenue manuellement synchronisée
// pour ce script ponctuel de migration unique.
const IS_LIST = [
  {
    slug: "sfpf",
    name: "Section du Féminisme et de Promotion de la Femme (SFPF-AMP)",
    description: "Favorise la participation des femmes et l’égalité des genres.",
    image: "https://res.cloudinary.com/diongmuh8/image/upload/f_auto,q_auto,w_800/v1780903897/ong-site/images/is/sfpf.webp",
    missions: [
      "Promouvoir les droits des femmes dans tous les domaines",
      "Lutter contre les violences basées sur le genre",
      "Encourager la participation politique et économique des femmes",
      "Organiser des campagnes de sensibilisation à l’égalité de genre",
    ],
  },
  {
    slug: "sepe",
    name: "Section d’Éducation et de Promotion de l’Enfance (SEPE-AMP)",
    description: "Soutient l’éducation des enfants et la protection de leurs droits.",
    image: "https://res.cloudinary.com/diongmuh8/image/upload/f_auto,q_auto,w_800/v1780903898/ong-site/images/is/sepe.webp",
    missions: [
      "Promouvoir l’accès à une éducation de qualité pour tous les enfants",
      "Prévenir le travail et l’exploitation des enfants",
      "Soutenir les enfants vulnérables et en situation difficile",
    ],
  },
  {
    slug: "spea",
    name: "Section de Promotion de l’Ecosystème et de l’Agriculture (SPEA-AMP)",
    description: "Agir pour la promotion du climat vert pour un avenir sûr.",
    image: "https://res.cloudinary.com/diongmuh8/image/upload/f_auto,q_auto,w_800/v1780903898/ong-site/images/is/spea.webp",
    missions: [
      "Promouvoir un environement et un climatvert",
      "Protection de l’écosystème et de la biodiversité",
      "Promouvoir l’agriculture écologique et verte",
    ],
  },
  {
    slug: "snie",
    name: "Section du Numérique, de l’Innovation et de l’Entrepreneuriat (SNIE-AMP)",
    description: "Encourage l’innovation numérique et l’entrepreneuriat des jeunes.",
    image: "https://res.cloudinary.com/diongmuh8/image/upload/f_auto,q_auto,w_800/v1780903899/ong-site/images/is/snie.webp",
    missions: [
      "Former les jeunes aux compétences numériques",
      "Encourager l’innovation technologique locale",
      "Accompagner les porteurs de projets entrepreneuriaux",
      "Organiser des hackathons et incubateurs d’idées",
    ],
  },
  {
    slug: "sccs",
    name: "Section de la Citoyenneté et de la Cohésion Sociale (SCCS-AMP)",
    description: "Renforce la citoyenneté active et la cohésion sociale.",
    image: "https://res.cloudinary.com/diongmuh8/image/upload/f_auto,q_auto,w_800/v1780903900/ong-site/images/is/sccs.webp",
    missions: [
      "Renforcer l’engagement civique des jeunes",
      "Promouvoir la paix, la tolérance et le vivre-ensemble",
      "Prévenir l’extrémisme violent et la désinformation",
      "Organiser des forums citoyens",
    ],
  },
  {
    slug: "sbsc",
    name: "Section du Bien-être et de Santé Communautaire (SBSC-AMP)",
    description: "Agit pour la santé communautaire et le bien-être social.",
    image: "https://res.cloudinary.com/diongmuh8/image/upload/f_auto,q_auto,w_800/v1780903901/ong-site/images/is/sbsc.webp",
    missions: [
      "Soutenir l’accès aux soins de santé pour tous",
      "Promouvoir la santé mentale et physique",
      "Mener des actions communautaires de prévention",
      "Renforcer les capacités des acteurs de santé locale",
    ],
  },
];

async function seed() {
  try {
    await connectDB();
    const Institution = getInstitutionCmsModel();

    let created = 0;
    let updated = 0;

    for (let i = 0; i < IS_LIST.length; i++) {
      const item = IS_LIST[i];
      const result = await Institution.findOneAndUpdate(
        { slug: item.slug },
        {
          slug: item.slug,
          name: item.name,
          description: item.description,
          image: item.image,
          missions: item.missions,
          order: i,
          status: "PUBLISHED",
        },
        { new: true, upsert: true, rawResult: true }
      );

      if (result.lastErrorObject?.updatedExisting) updated++;
      else created++;
    }

    console.log(`✅ Institutions migrées : ${created} créées, ${updated} mises à jour`);
    process.exit(0);
  } catch (err) {
    console.error("❌ ERREUR SEED INSTITUTIONS :", err);
    process.exit(1);
  }
}

seed();
