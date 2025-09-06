// config/db.js
const mongoose = require("mongoose");

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log(`✅ MongoDB connecté - 2ème Base de données - Mission volontaire: ${conn.connection.host}`);
  } catch (error) {
    console.error(`❌ Erreur MongoDB - 2ème Base de données - Mission volontaire : ${error.message}`);
    process.exit(1);
  }
};

module.exports = connectDB;
