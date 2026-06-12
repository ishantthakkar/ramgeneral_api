const mongoose = require('mongoose');

const leadSchema = new mongoose.Schema({
  lead_id: {
    type: String,
    trim: true,
    unique: true,
    sparse: true,
  },
  leadName: {
    type: String,
    required: false,
    trim: true,
  },
  name: {
    type: String,
    required: false,
    trim: true,
  },
  dba: {
    type: String,
    required: false,
    trim: true,
    default: '',
  },
  legalName: {
    type: String,
    required: false,
    trim: true,
    default: '',
  },
  accountNumber: {
    type: String,
    required: false,
    trim: true,
    default: '',
  },
  company: {
    type: String,
    required: false,
    trim: true,
  },
  electricCompany: {
    type: String,
    required: false,
    trim: true,
    default: '',
  },
  uploadElectricityBill: {
    type: [String],
    default: [],
  },
  billDate: {
    type: Date,
  },
  mobileNumber: {
    type: String,
    required: false,
    trim: true,
  },
  phone: {
    type: String,
    trim: true,
    default: '',
  },
  email: {
    type: String,
    trim: true,
    lowercase: true,
  },
  leadSource: {
    type: String,
    trim: true,
    uppercase: true,
  },
  addresses: [
    {
      title: { type: String, trim: true, default: '' },
      street: { type: String, trim: true, default: '' },
      city: { type: String, trim: true, default: '' },
      state: { type: String, trim: true, default: '' },
      zip: { type: String, trim: true, default: '' },
      createdAt: { type: Date, default: Date.now },
    },
  ],
  contactInfo: [
    {
      position: { type: String, trim: true, default: '' },
      department: { type: String, trim: true, default: '' },
      name: { type: String, trim: true, default: '' },
      phone: { type: String, trim: true, default: '' },
      mobile: { type: String, trim: true, default: '' },
      email: { type: String, trim: true, lowercase: true, default: '' },
      businessCard: { type: [String], default: [] },
      createdAt: { type: Date, default: Date.now },
    },
  ],
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
  notes: [{
    title: { type: String, trim: true, default: '' },
    note: { type: String, trim: true, default: '' },
    user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    createdAt: { type: Date, default: Date.now },
  }],
  activityLog: [{
    activityType: { type: String, trim: true, required: true },
    location: { type: String, trim: true, default: '' },
    date: { type: Date, default: Date.now },
    time: { type: String, trim: true, default: '' },
    note: { type: String, trim: true, default: '' },
    createdAt: { type: Date, default: Date.now },
  }],
  user_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  assignedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  assignedAt: {
    type: Date,
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
  lastActivity: {
    type: Date,
    default: Date.now,
  },
  status: {
    type: String,
    required: false,
    enum: ['New', 'Assigned', 'In Progress', 'Lost Leads', 'Converted To Customer'],
    default: 'New',
    trim: true,
  },
  convertedToCustomer: {
    type: Boolean,
    default: false,
  },
  lostReason: {
    type: String,
    trim: true,
    default: '',
  },
}, {
  timestamps: true,
});

const Lead = mongoose.model('Lead', leadSchema);
module.exports = Lead;
