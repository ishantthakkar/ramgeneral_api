const mongoose = require('mongoose');

const leadSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
  },
  company: {
    type: String,
    required: true,
    trim: true,
  },
  mobileNumber: {
    type: String,
    required: true,
    trim: true,
  },
  salesPerson: {
    type: String,
    required: true,
    trim: true,
  },
  lastActivity: {
    type: Date,
    default: Date.now,
  },
  status: {
    type: String,
    required: true,
    enum: ['New', 'In Progress', 'Closed', 'Converted To Customer'],
    default: 'New',
    trim: true,
  },
  convertedToCustomer: {
    type: Boolean,
    default: false,
  },
}, {
  timestamps: true,
});

const Lead = mongoose.model('Lead', leadSchema);
module.exports = Lead;
