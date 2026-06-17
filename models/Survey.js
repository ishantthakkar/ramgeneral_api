const mongoose = require('mongoose');
const { quotationFileFields } = require('../utils/quotationHelpers');
const { coerceSurveyNotes, getRawSurveyNotes } = require('../utils/surveyNotes');

const fixtureReportSchema = {
  installed_qty: { type: Number, default: 0 },
  heightFt: { type: String, trim: true, default: '' },
  heightIn: { type: String, trim: true, default: '' },
  note: { type: String, trim: true, default: '' },
  images: [{ type: String, trim: true }],
};

const fixtureVerificationSchema = {
  verified_qty: { type: Number, default: 0 },
  issueFound: { type: String, trim: true, enum: ['yes', 'no'], default: 'no' },
  comments: { type: String, trim: true, default: '' },
  images: [{ type: String, trim: true }],
};

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
  report: fixtureReportSchema,
  verification: fixtureVerificationSchema,
};

const materialDeliveryItemSchema = {
  sku: { type: String, trim: true, default: '' },
  issued_qty: { type: Number, default: 0 },
};

const materialDeliverySchema = {
  date: { type: Date },
  time: { type: String, trim: true, default: '' },
  items: [materialDeliveryItemSchema],
  note: { type: String, trim: true, default: '' },
  deliveryStatus: {
    type: String,
    enum: ['pending', 'scheduled', 'delivered', 'cancelled', 'approved', 'verified'],
    default: 'pending',
  },
  images: [{ type: String, trim: true }],
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  createdAt: { type: Date, default: Date.now },
};

const materialDeliveryReturnItemSchema = {
  item_name: { type: String, trim: true, default: '' },
  returned_qty: { type: Number, default: 0 },
};

const materialDeliveryReturnSchema = {
  date: { type: Date },
  time: { type: String, trim: true, default: '' },
  items: [materialDeliveryReturnItemSchema],
  note: { type: String, trim: true, default: '' },
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
  assignToContractor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  installationStatus: {
    type: String,
    enum: ['new', 'start', 'in_progress', 'continue', 'completed', 'submitted'],
    default: 'new',
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
      report_note: { type: String, trim: true, default: '' },
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
  projectManagerStatus: { type: String, trim: true, default: 'new' },
  installationStatus: {
    type: String,
    trim: true,
    enum: ['start', 'in_progress', 'continue', 'completed', 'submitted'],
    default: 'start',
  },
  installationDate: { type: Date },
  installationTime: { type: String, trim: true, default: '' },
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
  materialDeliveryReturn: [materialDeliveryReturnSchema],
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
