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
  email: {
    type: String,
    trim: true,
    lowercase: true,
  },
  leadSource: {
    type: String,
    trim: true,
  },
  street: {
    type: String,
    trim: true,
    default: '',
  },
  city: {
    type: String,
    trim: true,
    default: '',
  },
  state: {
    type: String,
    trim: true,
    default: '',
  },
  zip: {
    type: String,
    trim: true,
    default: '',
  },
  notes: {
    type: String,
    trim: true,
    default: '',
  },
  user_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  createdByName: {
    type: String,
    trim: true,
  },
  createdByEmail: {
    type: String,
    trim: true,
    lowercase: true,
  },
  createdByRole: {
    type: String,
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
    enum: ['New', 'In Progress', 'Lost Leads', 'Converted To Customer'],
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
