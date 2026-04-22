const mongoose = require('mongoose');

const customerSchema = new mongoose.Schema({
  accountNumber: {
    type: String,
    required: true,
    unique: true,
  },
  leadId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Lead',
  },
  user_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
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
  salesPerson: {
    type: String,
    required: true,
    trim: true,
  },
  contractor: {
    type: String,
    trim: true,
    default: '',
  },
  assignedTo: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  lastActivity: {
    type: Date,
    default: Date.now,
  },
  convertedDate: {
    type: Date,
    default: Date.now,
  },
  status: {
    type: String,
    required: true,
    enum: ['in_progress', 'draft', 'completed'],
    default: 'New',
    trim: true,
  },
  address: {
    street: { type: String, trim: true, default: '' },
    city: { type: String, trim: true, default: '' },
    state: { type: String, trim: true, default: '' },
    zip: { type: String, trim: true, default: '' },
  },
  activities: [
    {
      activityType: { type: String, trim: true, required: true },
      date: { type: Date, default: Date.now },
      nextFollowUpDate: { type: Date },
      outcome: { type: String, trim: true, default: '' },
    },
  ],
  notes: [
    {
      note: { type: String, trim: true, required: true },
      createdAt: { type: Date, default: Date.now },
    },
  ],
}, {
  timestamps: true,
});

customerSchema.pre('validate', async function (next) {
  if (!this.accountNumber) {
    this.accountNumber = Math.floor(1000 + Math.random() * 9000).toString();
  }
  next();
});

const Customer = mongoose.model('Customer', customerSchema);
module.exports = Customer;
