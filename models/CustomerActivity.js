const mongoose = require('mongoose');

const customerActivitySchema = new mongoose.Schema({
  customer_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Customer',
    required: true,
  },
  user_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  activityType: {
    type: String,
    required: true,
    enum: [
      'Call',
      'Meeting',
      'Site Visit',
      'WhatsApp',
      'Email',
      'Follow-up',
      'Schedule a Meeting',
      'Schedule Site Visit',
      'Quotation Approved',
      'Quotation Uploaded',
    ],
    trim: true,
  },
  date: {
    type: Date,
    default: Date.now,
  },
  timeSlot: {
    type: String,
    trim: true,
    default: '',
  },
  location: {
    type: String,
    trim: true,
    default: '',
  },
  address: {
    type: String,
    trim: true,
    default: '',
  },
  notes: {
    type: String,
    trim: true,
    default: '',
  },
  outcome: {
    type: String,
    trim: true,
    default: '',
  },
  nextFollowUpDate: {
    type: Date,
  },
}, {
  timestamps: true,
});

const CustomerActivity = mongoose.model('CustomerActivity', customerActivitySchema);
module.exports = CustomerActivity;
