const mongoose = require("mongoose");

const partnerSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true },
  location: { type: String, required: true },
  type: { type: String, required: true },
  amount: { type: Number, default: 0 },
  message: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },

  status: { type: String, enum: ["pending", "approved"], default: "pending" },
  handledBy: { type: mongoose.Schema.Types.ObjectId, ref: "GestionAmpUser", default: null },
  handledAt: { type: Date, default: null },
});

module.exports = mongoose.model("Partner", partnerSchema);
