const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  fullName: {
    type: String,
    required: true,
    trim: true,
  },
  company: {
    type: String,
    required: true,
    trim: true,
  },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
  },
  mobileNumber: {
    type: String,
    required: true,
    trim: true,
    unique: true
  },
  userRole: {
    type: String,
    required: true,
    trim: true,
  },
  roleId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Role'
  },
  status: {
    type: String,
    required: true,
    trim: true,
  },
  otpCode: {
    type: String,
    trim: true,
    default: '',
  },
  otpExpiresAt: {
    type: Date,
  },
  otpVerified: {
    type: Boolean,
    default: false,
  },
  refreshTokens: [
    {
      token: { type: String, trim: true },
      createdAt: { type: Date, default: Date.now },
    },
  ],
}, {
  timestamps: true,
});

const User = mongoose.model('User', userSchema);
module.exports = User;
