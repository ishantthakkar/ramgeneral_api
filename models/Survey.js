const mongoose = require('mongoose');
const { quotationFileFields } = require('../utils/quotationHelpers');
const { coerceSurveyNotes, getRawSurveyNotes } = require('../utils/surveyNotes');
const { coerceGenerateInvoice } = require('../utils/invoiceHelpers');
const { coerceSurveyExpensesForSave } = require('../utils/extraExpenseHelpers');

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

const areaVerificationNoteSchema = {
  title: { type: String, trim: true, default: '' },
  note: { type: String, trim: true, required: true },
  user_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  createdAt: { type: Date, default: Date.now },
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
  deliveryType: {
    type: String,
    enum: ['pickup', 'delivery'],
    trim: true,
  },
  items: [materialDeliveryItemSchema],
  note: { type: String, trim: true, default: '' },
  deliveryStatus: {
    type: String,
    enum: ['pending', 'scheduled', 'delivered', 'picked', 'cancelled', 'approved', 'verified'],
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

const expenseItemSchema = {
  itemName: { type: String, trim: true, default: '' },
  price: { type: Number, default: 0 },
  approvedAmount: { type: Number, default: 0 },
};

const expensesSchema = {
  expenseItem: [expenseItemSchema],
  notes: { type: String, trim: true, default: '' },
  totalAmount: { type: Number, default: 0 },
  adminExpenseApprovalStatus: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending',
    trim: true,
  },
  adminApprovalAmount: { type: Number, default: 0 },
  receipt: [{ type: String, trim: true }],
};

const extraExpensePaymentSchema = {
  amount: { type: Number, required: true, min: 0 },
  paymentMethod: {
    type: String,
    enum: [
      'Cash',
      'ACH Transfer',
      'Wire Transfer',
      'Check',
      'Credit Card',
      'Debit Card',
      'PayPal',
      'Stripe',
      'Other',
    ],
    trim: true,
  },
  note: { type: String, trim: true, default: '' },
  paymentDate: { type: Date, default: Date.now },
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
  surveyType: {
    type: String,
    trim: true,
    enum: ['direct', 'utility'],
    default: 'direct',
  },
  areaName: { type: String, trim: true, default: '' },
  note: { type: String, trim: true, default: '' },
  areas: [
    {
      areaName: { type: String, trim: true, default: '' },
      note: { type: String, trim: true, default: '' },
      images: [{ type: String, trim: true }],
      fixtures: [fixtureSchema],
      report_note: { type: String, trim: true, default: '' },
      verification_notes: [areaVerificationNoteSchema],
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
    enum: ['new', 'start', 'in_progress', 'continue', 'completed', 'submitted'],
    default: 'new',
  },
  installationDate: { type: Date },
  installationTime: { type: String, trim: true, default: '' },
  inspectionStatus: {
    type: String,
    trim: true,
    enum: ['to-do', 'reopen', 'in_progress', 'confirm', 'verified', 'submitted'],
    default: 'to-do',
  },
  inspectionDate: { type: Date },
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
  invoiceNumber: { type: String, trim: true, default: '' },
  invoiceStatus: {
    type: String,
    enum: ['pending', 'approved', 'fully_paid'],
    default: 'pending',
    trim: true,
  },
  invoicePaidAt: { type: Date },
  invoiceGeneratedAt: { type: Date },
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
  generateInvoice: { type: String, trim: true, default: '' },
  expenses: {
    type: expensesSchema,
    default: () => ({
      expenseItem: [],
      notes: '',
      totalAmount: 0,
      adminExpenseApprovalStatus: 'pending',
      adminApprovalAmount: 0,
      receipt: [],
    }),
  },
  extraExpensePayments: [extraExpensePaymentSchema],
}, {
  timestamps: true,
});

surveySchema.pre('validate', function normalizeLegacySurveyFields(next) {
  this.set('notes', coerceSurveyNotes(getRawSurveyNotes(this)));
  this.set('generateInvoice', coerceGenerateInvoice(this.get('generateInvoice')));
  this.set('expenses', coerceSurveyExpensesForSave(this));
  next();
});

const Survey = mongoose.model('Survey', surveySchema);
module.exports = Survey;
