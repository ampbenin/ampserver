// config/db.js
const mongoose = require("mongoose");

const connectDB = async () => {
  try {
    // 🔵 Connexion 1 : Base volontaire en ligne
    const mainConn = await mongoose.connect(process.env.MONGODB_URI);
    console.log(`✅ MongoDB connecté - BASE PRINCIPALE : ${mainConn.connection.host}`);

    // 🔵 Connexion 2 : Base formulaire + admin
    if (process.env.MONGODB_URI_FORM) {
      const formConn = mongoose.createConnection(process.env.MONGODB_URI_FORM);

      formConn.on("connected", () => {
        console.log(`📄 MongoDB connecté - BASE FORMULAIRES : ${process.env.MONGODB_URI_FORM}`);
      });

      formConn.on("error", (err) => {
        console.error("❌ Erreur MongoDB - BASE FORMULAIRES :", err.message);
      });

      global.formDB = formConn;
    } else {
      console.log("⚠️ MONGODB_URI_FORM non défini dans .env");
    }

  } catch (error) {
    console.error(`❌ Erreur MongoDB : ${error.message}`);
    process.exit(1);
  }
};

module.exports = connectDB;
