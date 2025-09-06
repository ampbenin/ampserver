const express = require("express");
const dotenv = require("dotenv");
const connectDB = require("./config/db");
const cors = require("cors");
const volunteerRoutes = require("./routes/volunteerRoute");
const missionRoutes = require("./routes/missionRoute");
const adminRoutes = require("./routes/adminRoute");
const certificateRoutes = require("./routes/certificateRoute"); // ← ajouter
const { errorHandler } = require("./middlewares/errorHandler");

// Charger les variables d'environnement
dotenv.config();

// Connexion à MongoDB
connectDB();

const app = express();

// Middleware pour parser le JSON
app.use(express.json());

// Autoriser les requêtes depuis ton frontend local
app.use(cors({
  origin: "http://localhost:4321", // 🔹 Adresse de ton frontend
  methods: ["GET","POST","PUT","DELETE"],
  credentials: true
}));


// Routes principales
app.use("/api/volunteers", volunteerRoutes);
app.use("/api/missions", missionRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/certificates", certificateRoutes); // ← route certificats

// Middleware d’erreurs
app.use(errorHandler);

// Démarrage du serveur
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Serveur en cours sur le port ${PORT}`);
});
