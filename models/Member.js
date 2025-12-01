const mongoose = require('mongoose');

const memberSchema = new mongoose.Schema({
  fullName: { type: String, required: true },
  email: { type: String, required: true },
  phone: { type: String },
  countryCity: { type: String, required: true },
  otherCountry: { type: String },
  dob: { type: Date },
  gender: { type: String },
  otherGender: { type: String },
  role: { type: String },
  availability: { type: String },
  interests: { type: [String] },
  otherInterest: { type: String },
  motivation: { type: String, required: true },
  consent: { type: Boolean, required: true },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Member', memberSchema);
