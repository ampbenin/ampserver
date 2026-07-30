const router = require("express").Router();
const controller = require("../../controllers/admin/newsletterController");
const authMiddleware = require("../../middlewares/gestionamp/authMiddleware");
const roleMiddleware = require("../../middlewares/gestionamp/roleMiddleware");

router.use(authMiddleware, roleMiddleware("ADMIN"));

router.get("/", controller.getAll);
router.post("/send", controller.sendMail);
router.delete("/:id", controller.remove);

module.exports = router;
