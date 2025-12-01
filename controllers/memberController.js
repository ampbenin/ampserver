const Member = require('../models/Member');

exports.saveMember = async (req, res) => {
  try {
    const {
      fullName,
      email,
      phone,
      countryCity,
      otherCountry,
      dob,
      gender,
      otherGender,
      role,
      availability,
      interests,
      otherInterest,
      motivation,
      consent
    } = req.body;

    if (!consent) {
      return res.status(400).json({ result: 'error', error: 'Consentement requis.' });
    }

    const newMember = new Member({
      fullName,
      email,
      phone,
      countryCity,
      otherCountry,
      dob,
      gender,
      otherGender,
      role,
      availability,
      interests,
      otherInterest,
      motivation,
      consent
    });

    await newMember.save();

    res.json({ result: 'success', message: 'Membre enregistré avec succès' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ result: 'error', error: error.message });
  }
};
