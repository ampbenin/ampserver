const streamifier = require("streamifier");
const cloudinary = require("../../utils/cloudinary");
const getMediaModel = require("../../models/cms/Media");

const uploadFromBuffer = (buffer, folder) => {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      { folder, resource_type: "image" },
      (error, result) => {
        if (error) return reject(error);
        resolve(result);
      }
    );
    streamifier.createReadStream(buffer).pipe(uploadStream);
  });
};

/* -------------------- Uploader un média -------------------- */
const upload = async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "Aucun fichier reçu" });
    }

    const folder = req.body.folder
      ? `ong-site/cms/${req.body.folder}`
      : "ong-site/cms";

    const uploaded = await uploadFromBuffer(req.file.buffer, folder);

    const Media = getMediaModel();
    const media = await Media.create({
      url: uploaded.secure_url,
      publicId: uploaded.public_id,
      folder,
      alt: req.body.alt || "",
      uploadedBy: req.user.id,
    });

    res.status(201).json(media);
  } catch (error) {
    next(error);
  }
};

/* -------------------- Lister les médias (picker admin) -------------------- */
const list = async (req, res, next) => {
  try {
    const Media = getMediaModel();
    const { page = 1, limit = 40 } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const [items, total] = await Promise.all([
      Media.find().sort({ createdAt: -1 }).skip(skip).limit(Number(limit)),
      Media.countDocuments(),
    ]);

    res.json({ success: true, items, total, page: Number(page), limit: Number(limit) });
  } catch (error) {
    next(error);
  }
};

module.exports = { upload, list };
