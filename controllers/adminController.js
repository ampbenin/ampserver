const bcrypt = require("bcryptjs");
const Admin = require("../models/admin");
const generateJwt = require("../utils/generateJwt");

// 🔑 Connexion admin
const loginAdmin = async (req, res, next) => {
  try {
    const { username, password } = req.body;

    // Vérifier utilisateur
    const admin = await Admin.findOne({ username });
    if (!admin) {
      return res.status(401).json({ message: "Identifiant ou mot de passe incorrect" });
    }

    // Vérifier mot de passe
    const isMatch = await bcrypt.compare(password, admin.password);
    if (!isMatch) {
      return res.status(401).json({ message: "Identifiant ou mot de passe incorrect" });
    }

    // Générer token
    const token = generateJwt(admin);

    res.json({
      token,
      role: admin.role,
      missions: admin.missions,
    });
  } catch (error) {
    next(error);
  }
};

// 🆕 Créer un admin (à utiliser une fois pour initialiser)
const registerAdmin = async (req, res, next) => {
  try {
    const { username, password, role, missions } = req.body;

    // Vérifie si déjà existant
    const existingAdmin = await Admin.findOne({ username });
    if (existingAdmin) {
      return res.status(400).json({ message: "Cet utilisateur existe déjà" });
    }

    // Hash mot de passe
    const hashedPassword = await bcrypt.hash(password, 10);

    const newAdmin = new Admin({
      username,
      password: hashedPassword,
      role,
      missions,
    });

    await newAdmin.save();

    res.status(201).json({ message: "Admin créé avec succès" });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  loginAdmin,
  registerAdmin,
};
