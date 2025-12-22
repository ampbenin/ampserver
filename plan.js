// plan.js
require("dotenv").config();
const mongoose = require("mongoose");
const Volunteer = require("./models/volunteer");
const Mission = require("./models/mission");

async function connectDB() {
  try {
    const conn = await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log(`✅ Connecté à MongoDB - BASE PRINCIPALE : ${conn.connection.host}`);
  } catch (error) {
    console.error("❌ Erreur de connexion MongoDB :", error.message);
    process.exit(1);
  }
}

async function cleanGhostMissions() {
  try {
    const missions = await Mission.find({}, "_id");
    const validMissionIds = missions.map(m => m._id.toString());

    const volunteers = await Volunteer.find();

    for (const volunteer of volunteers) {
      const ghostMissions = volunteer.missions.filter(
        m => !m.missionId || !validMissionIds.includes(m.missionId.toString())
      );

      if (ghostMissions.length > 0) {
        console.log(`Nettoyage pour ${volunteer.email} : ${ghostMissions.length} mission(s) supprimée(s)`);

        await Volunteer.updateOne(
          { _id: volunteer._id },
          { $pull: { missions: { missionId: { $in: ghostMissions.map(m => m.missionId) } } } }
        );
      }
    }

    console.log("✅ Nettoyage des missions fantômes terminé !");
  } catch (err) {
    console.error("❌ Erreur lors du nettoyage :", err);
  }
}

async function main() {
  await connectDB();
  await cleanGhostMissions();
  await mongoose.disconnect();
  console.log("✅ Déconnexion MongoDB terminée");
}

main();
