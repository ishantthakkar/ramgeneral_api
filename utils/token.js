const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'supersecretkey';
const ACCESS_TOKEN_EXPIRES_IN = '7d';
const REFRESH_TOKEN_EXPIRES_IN = '7d';

const generateAccessToken = (admin) => {
  return jwt.sign(
    { id: admin._id, email: admin.email },
    JWT_SECRET,
    { expiresIn: ACCESS_TOKEN_EXPIRES_IN }
  );
};

const generateRefreshToken = (admin) => {
  return jwt.sign(
    { id: admin._id, email: admin.email },
    JWT_SECRET,
    { expiresIn: REFRESH_TOKEN_EXPIRES_IN }
  );
};

module.exports = {
  generateAccessToken,
  generateRefreshToken,
};
