const express = require("express");
const multer = require("multer");
const router = express.Router();
const ctrl = require("../../controllers/cms/mediaController");
const authMiddleware = require("../../middlewares/gestionamp/authMiddleware");
const roleMiddleware = require("../../middlewares/gestionamp/roleMiddleware");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 Mo
});

router.use(authMiddleware, roleMiddleware("ADMIN", "EDITOR"));

router.get("/", ctrl.list);
router.post("/", upload.single("file"), ctrl.upload);

module.exports = router;
