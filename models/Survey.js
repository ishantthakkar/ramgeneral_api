const mongoose = require('mongoose');
const { quotationFileFields } = require('../utils/quotationHelpers');
const { coerceSurveyNotes, getRawSurveyNotes } = require('../utils/surveyNotes');

const fixtureSchema = {
  product_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
  },
  heightFt: { type: String, trim: true, default: '' },
  heightIn: { type: String, trim: true, default: '' },
  existingBulbs: { type: String, trim: true, default: '' },
  existingFixtureType: { type: String, trim: true, default: '' },
  note: { type: String, trim: true, default: '' },
  existingQty: { type: String, trim: true, default: '' },
  proposedQty: { type: String, trim: true, default: '' },
  price: { type: String, trim: true, default: '' },
  images: [{ type: String, trim: true }],
};

const materialDeliveryItemSchema = {
  product_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
  },
  issued_qty: { type: Number, default: 0 },
};

const materialDeliverySchema = {
  date: { type: Date },
  time: { type: String, trim: true, default: '' },
  items: [materialDeliveryItemSchema],
  note: { type: String, trim: true, default: '' },
  deliveryStatus: {
    type: String,
    enum: ['pending', 'scheduled', 'delivered', 'cancelled'],
    default: 'pending',
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  createdAt: { type: Date, default: Date.now },
};

const surveySchema = new mongoose.Schema({
  customer_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Customer',
    required: false,
  },
  user_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: false,
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
    enum: ['Draft', 'In Progress', 'Completed', 'draft', 'in_progress', 'completed', 'submitted', 'reopen'],
    default: 'Draft',
  },
  surveyName: { type: String, trim: true, default: '' },
  areaName: { type: String, trim: true, default: '' },
  note: { type: String, trim: true, default: '' },
  areas: [
    {
      areaName: { type: String, trim: true, default: '' },
      note: { type: String, trim: true, default: '' },
      images: [{ type: String, trim: true }],
      fixtures: [fixtureSchema],
    },
  ],
  notes: [
    {
      title: { type: String, trim: true, default: '' },
      note: { type: String, trim: true, required: true },
      user_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
      },
      createdAt: { type: Date, default: Date.now },
    },
  ],
  markAsCompleted: { type: Boolean, default: false },
  verifyImages: [{ type: String, trim: true }],
  verifyQty: { type: Number, default: 0 },
  issueFound: { type: String, trim: true, enum: ['yes', 'no'], default: 'no' },
  verificationComments: { type: String, trim: true, default: '' },
  editApprovalStatus: {
    type: String,
    enum: ['none', 'pending', 'approved', 'rejected'],
    default: 'none',
  },
  editApprovalBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  editApprovalAt: { type: Date },
  quotationStatus: {
    type: String,
    enum: ['pending', 'approved'],
    default: 'pending',
  },
  quotationApprovedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  quotationApprovedAt: { type: Date },
  confirmDate: { type: Date },
  job_id: {
    type: String,
    trim: true,
    unique: true,
    sparse: true,
  },
  materialDelivery: [materialDeliverySchema],
  materialDeliveryReturn: { type: Array, default: [] },
  deliverySummary: { type: Array, default: [] },
  generateQuotation: [quotationFileFields],
  uploadSignedQuotation: [quotationFileFields],
}, {
  timestamps: true,
});

surveySchema.pre('validate', function normalizeLegacySurveyNotes(next) {
  this.set('notes', coerceSurveyNotes(getRawSurveyNotes(this)));
  next();
});

const Survey = mongoose.model('Survey', surveySchema);
module.exports = Survey;
