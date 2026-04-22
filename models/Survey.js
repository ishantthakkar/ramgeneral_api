const mongoose = require('mongoose');

const surveySchema = new mongoose.Schema({
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
  assignedTo: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  surveyDate: {
    type: Date,
    default: Date.now,
  },
  status: {
    type: String,
    trim: true,
    enum: ['Draft', 'In Progress', 'Completed'],
    default: 'Draft',
  },
  area: { type: String, trim: true, required: true },
  heightInInches: { type: String, trim: true, default: '' },
  existingFixtureType: { type: String, trim: true, default: '' },
  otherFixtureType: { type: String, trim: true, default: '' },
  existingBulbs: { type: String, trim: true, default: '' },
  existingQuantity: { type: String, trim: true, default: '' },
  proposedFixture: { type: String, trim: true, default: '' },
  proposedQuantity: { type: String, trim: true, default: '' },
  pricePerUnit: { type: String, trim: true, default: '' },
  totalPrice: { type: String, trim: true, default: '' },
  note: { type: String, trim: true, default: '' },
  images: [{ type: String, trim: true }],
  notes: { type: String, trim: true, default: '' },
}, {
  timestamps: true,
});

const Survey = mongoose.model('Survey', surveySchema);
module.exports = Survey;
