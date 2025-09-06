const jwt = require("jsonwebtoken");

const generateJwt = (admin) => {
  return jwt.sign(
    {
      id: admin._id,
      username: admin.username,
      role: admin.role,
    },
    process.env.JWT_SECRET,
    { expiresIn: "1h" }
  );
};

module.exports = generateJwt;
