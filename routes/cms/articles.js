const express = require("express");
const router = express.Router();
const ctrl = require("../../controllers/cms/articleController");
const authMiddleware = require("../../middlewares/gestionamp/authMiddleware");
const roleMiddleware = require("../../middlewares/gestionamp/roleMiddleware");

const requireEditor = [authMiddleware, roleMiddleware("ADMIN", "EDITOR")];

// 🔐 Admin (déclaré avant "/:slug" pour ne pas être capté par le paramètre générique)
router.get("/admin", ...requireEditor, ctrl.adminList);
router.get("/admin/:id", ...requireEditor, ctrl.adminGetById);
router.post("/admin", ...requireEditor, ctrl.create);
router.put("/admin/:id", ...requireEditor, ctrl.update);
router.delete("/admin/:id", ...requireEditor, ctrl.remove);

// 🌐 Public
router.get("/", ctrl.listPublished);
router.get("/:slug", ctrl.getPublishedBySlug);

module.exports = router;
