// plan.js
require("dotenv").config();
const mongoose = require("mongoose");

const Volunteer = require("./models/volunteer");
const Mission = require("./models/mission");

const TARGET_MISSION_TITLE = "MyCountry229_08_2025";

async function main() {
  try {
    // 1️⃣ Connexion à la BASE PRINCIPALE
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("✅ Connecté à MongoDB (base principale)");

    // 2️⃣ Récupérer la mission cible
    const mission = await Mission.findOne({ titre: TARGET_MISSION_TITLE });
    if (!mission) {
      console.error(`❌ Mission "${TARGET_MISSION_TITLE}" introuvable`);
      process.exit(1);
    }

    console.log(`🎯 Mission cible : ${mission.titre}`);

    // 3️⃣ Récupérer tous les volontaires
    const volunteers = await Volunteer.find();
    let updated = 0;

    for (const volunteer of volunteers) {
      const hasValidAttestation = volunteer.attestations?.some(
        a => a.fileUrl && a.missionId
      );

      const statut = hasValidAttestation
        ? "Mission validée"
        : "Non disponible";

      // Vérifier si la mission est déjà assignée
      const alreadyAssigned = volunteer.missions.some(
        m => m.missionId?.toString() === mission._id.toString()
      );

      if (!alreadyAssigned) {
        volunteer.missions.push({
          missionId: mission._id,
          statut,
        });
        updated++;
      } else {
        // Mise à jour du statut si déjà présent
        volunteer.missions = volunteer.missions.map(m => {
          if (m.missionId?.toString() === mission._id.toString()) {
            return { ...m, statut };
          }
          return m;
        });
      }

      await volunteer.save();
    }

    console.log(`✅ Migration terminée`);
    console.log(`🔄 Volontaires mis à jour : ${updated}`);

    await mongoose.disconnect();
    console.log("🔌 Déconnecté de MongoDB");
  } catch (err) {
    console.error("❌ Erreur migration :", err);
    process.exit(1);
  }
}

main();
