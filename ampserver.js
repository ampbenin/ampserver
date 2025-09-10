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
const allowedOrigins = [
  "http://localhost:4321",         // 🔹 ton frontend local
  "https://ampbenin.netlify.app"  // 🔹 ton frontend déployé (Render)
];

app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  methods: "*",
  credentials: true
}));


// Routes principales
app.use("/api/volunteers", volunteerRoutes);
app.use("/api/missions", missionRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/certificates", certificateRoutes); // ← route certificats

// ✅ Route racine
app.get("/", (req, res) => {
  res.send("🚀 Backend AMP Benin déployé avec succès en ligne !");
});

// ✅ Health check
app.get("/ampserver", (req, res) => {
  res.json({ status: "ok", message: "Votre back-end AMP BENIN - GESTION DES MISSIONS DES VOLONTAIRES et les API fonctionnent bien 🚀" });
});


// Middleware d’erreurs
app.use(errorHandler);

// Démarrage du serveur
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Serveur en cours sur le port ${PORT}`);
});
