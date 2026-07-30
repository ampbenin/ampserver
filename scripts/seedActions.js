/**
 * Script : migration ponctuelle du tableau `actions` codé en dur
 * (NosActions.jsx) vers la collection CMS `Action` (Mongo). À exécuter
 * une seule fois :
 *
 *   node scripts/seedActions.js
 */

require("dotenv").config();
const connectDB = require("../config/db");
const getActionCmsModel = require("../models/cms/Action");

const ACTIONS = [
  {
    title: "Projet À l'écoute des jeunes (2023)",
    description: "Renforcement de capacités des jeunes filles dans les communes de Tori-Bossito et Kpomassè sur la SSR, la prévention des VBG et l'autonomisation des femmes. Ce projet a duré 6 mois et a permis de former et accompagner plusieurs bénéficiaires.",
    media: "https://res.cloudinary.com/diongmuh8/image/upload/f_auto,q_auto,w_800/v1780903892/ong-site/images/forum-jeunesse.webp",
    type: "image",
    theme: "SSR",
    year: 2023,
  },
  {
    title: "16 jours d'activisme contre les VBG (2024)",
    description: "Mobilisation de plus de 200 jeunes volontaires pour une campagne digitale et communautaire de grande envergure. AMP BENIN a été reconnu comme jeune organisation championne par Plan International West and Central Africa.",
    media: "https://res.cloudinary.com/diongmuh8/image/upload/f_auto,q_auto,w_800/v1780903906/ong-site/images/16jours/Lancement-16jours.webp",
    type: "image",
    reportUrl: "/docs/rapport-vbg.pdf",
    theme: "VBG",
    year: 2024,
  },
  {
    title: "Projet MyCountry229 (2025)",
    description: "Campagne nationale digitale innovante mobilisant des centaines de jeunes autour de la citoyenneté, des ODD et de la lutte contre la désinformation. Un projet qui a marqué l'engagement citoyen numérique au Bénin.",
    media: "https://res.cloudinary.com/diongmuh8/image/upload/f_auto,q_auto,w_800/v1780903905/ong-site/images/campagne-mycountry229-paix-benin.png",
    type: "image",
    reportUrl: "/docs/rapport-mycountry229.pdf",
    theme: "Citoyenneté",
    year: 2025,
  },
  {
    title: "Projet SWEED1 (2024) (2023)",
    description: "Implication d'AMP BENIN dans les communes de Tori-Bossito et Kpomassè, avec un focus sur le renforcement de capacités et l'autonomisation des femmes, en collaboration avec les guichets uniques de protection sociale.",
    media: "https://res.cloudinary.com/diongmuh8/image/upload/f_auto,q_auto,w_800/v1780903894/ong-site/images/sante-bienetre-social.webp",
    type: "image",
    theme: "Autonomisation",
    year: 2023,
  },
  {
    title: "Projet ARS3 avec PSI/AMBS (2025)",
    description: "Partenaire d'exécution dans la commune de Comè (Mono) pour la sensibilisation des communautés, femmes enceintes et jeunes filles à l'accès aux services de santé.",
    media: "https://res.cloudinary.com/diongmuh8/image/upload/f_auto,q_auto,w_800/v1780903897/ong-site/images/is/sfpf.webp",
    type: "image",
    theme: "SSR",
    year: 2025,
  },
  {
    title: "Espace jeunesse (2024)",
    description: "Création d'un espace dédié aux jeunes pour favoriser leur participation citoyenne, leur accès à l'information et aux ressources éducatives, ainsi que leur engagement actif dans la prévention des VBG et la promotion de la SSR.",
    media: "https://res.cloudinary.com/diongmuh8/image/upload/f_auto,q_auto,w_800/v1780903900/ong-site/images/is/sccs.webp",
    type: "image",
    theme: "Jeunesse",
    year: 2024,
  },
];

async function seed() {
  try {
    await connectDB();
    const Action = getActionCmsModel();

    let created = 0;
    for (let i = 0; i < ACTIONS.length; i++) {
      const existing = await Action.findOne({ title: ACTIONS[i].title });
      if (existing) continue;
      await Action.create({ ...ACTIONS[i], order: i, status: "PUBLISHED" });
      created++;
    }

    console.log(`✅ Actions migrées : ${created} créées (${ACTIONS.length - created} déjà existantes)`);
    process.exit(0);
  } catch (err) {
    console.error("❌ ERREUR SEED ACTIONS :", err);
    process.exit(1);
  }
}

seed();
