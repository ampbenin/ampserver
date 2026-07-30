/**
 * Script : migration ponctuelle des 4 cartes codées en dur de programmes.astro
 * vers la collection CMS `Programme` (Mongo). À exécuter une seule fois :
 *
 *   node scripts/seedProgrammes.js
 */

require("dotenv").config();
const connectDB = require("../config/db");
const getProgrammeModel = require("../models/cms/Programme");

const PROGRAMMES = [
  {
    slug: "campagne-paix",
    title: "🕊️ Campagne nationale pour la paix",
    description:
      "Initiative de mobilisation en ligne pour la cohésion sociale, la lutte contre la désinformation et la radicalisation, lancée à l’occasion du 1er août.\n\nPériode : Juillet - Août 2025",
  },
  {
    slug: "education-leadership-jeunesse",
    title: "🎓 Éducation et leadership jeunesse",
    description:
      "Formations, clubs scolaires et mentorat pour éveiller les jeunes à l’engagement citoyen et à la réalisation des Objectifs de Développement Durable (ODD).\n\nEn cours dans plusieurs établissements",
  },
  {
    slug: "sante-bien-etre",
    title: "👩🏾‍⚕️ Santé et bien-être",
    description:
      "Sensibilisation sur les violences basées sur le genre (VBG), la santé mentale, les droits sexuels et reproductifs, avec accompagnement communautaire.\n\nEn partenariat avec des ONG locales",
  },
  {
    slug: "innovation-developpement-durable",
    title: "🌱 Innovation & développement durable",
    description:
      "Projets numériques, écologiques et entrepreneuriaux portés par les jeunes pour accélérer la mise en œuvre des ODD dans les communautés.\n\nProjets pilotes en cours",
  },
];

async function seed() {
  try {
    await connectDB();
    const Programme = getProgrammeModel();

    let created = 0;
    let updated = 0;

    for (let i = 0; i < PROGRAMMES.length; i++) {
      const item = PROGRAMMES[i];
      const result = await Programme.findOneAndUpdate(
        { slug: item.slug },
        {
          slug: item.slug,
          title: item.title,
          description: item.description,
          order: i,
          status: "PUBLISHED",
        },
        { new: true, upsert: true, rawResult: true }
      );

      if (result.lastErrorObject?.updatedExisting) updated++;
      else created++;
    }

    console.log(`✅ Programmes migrés : ${created} créés, ${updated} mis à jour`);
    process.exit(0);
  } catch (err) {
    console.error("❌ ERREUR SEED PROGRAMMES :", err);
    process.exit(1);
  }
}

seed();
