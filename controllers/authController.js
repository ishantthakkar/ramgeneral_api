const bcrypt = require('bcryptjs');
const Admin = require('../models/Admin');
const { generateAccessToken, generateRefreshToken } = require('../utils/token');

exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required.' });
    }

    const admin = await Admin.findOne({ email: email.toLowerCase() });
    if (!admin) {
      return res.status(401).json({ message: 'Invalid email or password.' });
    }

    const passwordMatches = await bcrypt.compare(password, admin.password);
    if (!passwordMatches) {
      return res.status(401).json({ message: 'Invalid email or password.' });
    }

    const accessToken = generateAccessToken(admin);
    const refreshToken = generateRefreshToken(admin);

    admin.refreshTokens.push({ token: refreshToken });
    await admin.save();

    return res.json({
      email: admin.email,
      accessToken,
      refreshToken,
    });
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({ message: 'Server error during login.' });
  }
};

exports.logout = async (req, res) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(400).json({ message: 'Refresh token is required.' });
    }

    const admin = await Admin.findOne({ 'refreshTokens.token': refreshToken });
    if (!admin) {
      return res.status(200).json({ message: 'Logged out successfully.' });
    }

    admin.refreshTokens = admin.refreshTokens.filter(
      (tokenEntry) => tokenEntry.token !== refreshToken
    );

    await admin.save();

    return res.json({ message: 'Logged out successfully.' });
  } catch (error) {
    console.error('Logout error:', error);
    return res.status(500).json({ message: 'Server error during logout.' });
  }
};
