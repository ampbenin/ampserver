/**
 * Modèle Media – CMS AMP BENIN (DB2)
 * N'indexe que les métadonnées ; le fichier réel reste sur Cloudinary.
 */

const mongoose = require("mongoose");

const MediaSchema = new mongoose.Schema(
  {
    url: { type: String, required: true },
    publicId: { type: String, required: true },
    folder: { type: String, default: "ong-site/cms" },
    alt: { type: String, default: "" },

    uploadedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "GestionAmpUser",
      default: null,
    },
  },
  { timestamps: true }
);

module.exports = function getMediaModel() {
  const formDB = global.formDB;

  if (!formDB) {
    throw new Error("❌ formDB non initialisée (Media)");
  }

  return formDB.models.CmsMedia || formDB.model("CmsMedia", MediaSchema);
};
