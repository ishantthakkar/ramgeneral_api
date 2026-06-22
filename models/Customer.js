const mongoose = require('mongoose');
const { quotationFileFields } = require('../utils/quotationHelpers');

const customerSchema = new mongoose.Schema({
  customerCode: {
    type: String,
    trim: true,
    unique: true,
    sparse: true,
  },
  accountNumber: {
    type: String,
    trim: true,
    default: '',
  },
  dba: {
    type: String,
    trim: true,
    default: '',
  },
  leadId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Lead',
  },
  legalName: {
    type: String,
    trim: true,
    default: '',
  },
  uploadElectricityBill: {
    type: [String],
    default: [],
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
  user_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  name: {
    type: String,
    required: false,
    trim: true,
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
  billDate: {
    type: Date,
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
  assignedTo: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  assignToContractor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  contractorStatus: {
    type: String,
    enum: ['New', 'In Progress', 'Completed', 'completed', 'in progress', 'to-do'],
    default: 'New',
    trim: true,
  },
  projectManagerStatus: {
    type: String,
    enum: ['to-do', 'in_progress', 'completed'],
    default: 'to-do',
    trim: true,
  },
  verifyStatus: {
    type: String,
    enum: ['pending', 'verified', 'completed', 'submitted'],
    default: 'pending',
    trim: true,
  },
  commissions: [
    {
      surveyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Survey' },
      commissionType: { type: String, enum: ['Survey', 'Sales Manager', 'Installation', 'Other'], required: true },
      salesPerson: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      salesManager: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      contractor: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      otherName: { type: String, trim: true },
      amount: { type: Number, default: 0 },
      paidAmount: { type: Number, default: 0 },
      paymentMethod: {
        type: String,
        enum: ['Cash', 'ACH Transfer', 'Wire Transfer', 'Check', 'Credit Card', 'Debit Card', 'PayPal', 'Stripe', 'Other'],
        trim: true
      },
      paymentDate: { type: Date },
      paymentStatus: {
        type: String,
        enum: ['paid', 'payment pending'],
        default: 'payment pending'
      },
      payments: [
        {
          amount: { type: Number, required: true, min: 0 },
          paymentMethod: {
            type: String,
            enum: ['Cash', 'ACH Transfer', 'Wire Transfer', 'Check', 'Credit Card', 'Debit Card', 'PayPal', 'Stripe', 'Other'],
            trim: true,
          },
          note: { type: String, trim: true, default: '' },
          paymentDate: { type: Date, default: Date.now },
          createdAt: { type: Date, default: Date.now },
        },
      ],
      date: { type: Date, default: Date.now },
    },
  ],
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
    required: false,
    enum: ['New', 'in_progress', 'draft', 'completed', 'reopen', 'pending_edit_approval', 'submitted'],
    default: 'New',
    trim: true,
  },
  adminApproval: {
    type: String,
    enum: ['Pending', 'Approved', 'Rejected'],
    default: 'Pending',
    trim: true,
  },
  address: {
    street: { type: String, trim: true, default: '' },
    city: { type: String, trim: true, default: '' },
    state: { type: String, trim: true, default: '' },
    zip: { type: String, trim: true, default: '' },
  },
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
  material: [
    {
      item_name: { type: String, trim: true },
      issued_qty: { type: Number, default: 0 },
      issued_date: { type: Date, default: Date.now },
      images: [{ type: String }],
    },
  ],
  materialStatus: {
    type: String,
    enum: ['pending', 'verified'],
    default: 'pending',
  },
  installationStatus: {
    type: String,
    enum: ['to-do', 'start', 'in_progress', 'continue', 'completed', 'reopen'],
    default: 'to-do',
  },
  electricCompany: {
    type: String,
    required: false,
    trim: true,
    default: '',
  },
  inspectionStatus: {
    type: String,
    enum: ['to-do', 'reopen', 'in_progress', 'confirm', 'submitted', 'verified'],
    default: 'to-do',
  },
  installationNotes: [
    {
      note: { type: String, trim: true, required: true },
      timestamp: { type: Date, default: Date.now },
    },
  ],
  inspectionNotes: [
    {
      note: { type: String, trim: true, required: true },
      timestamp: { type: Date, default: Date.now },
    },
  ],
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
  generateQuotation: [quotationFileFields],
  uploadSignedQuotation: [quotationFileFields],
  quotations: [
    {
      url: { type: String, trim: true, default: '' },
      filename: { type: String, trim: true, default: '' },
      pdfName: { type: String, trim: true, default: '' },
      mimeType: { type: String, trim: true, default: '' },
      source: {
        type: String,
        enum: ['generated', 'uploaded'],
        default: 'generated',
      },
      uploadedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
      },
      uploadedByName: { type: String, trim: true, default: '' },
      surveyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Survey' },
      subtotal: { type: Number, default: 0 },
      taxAmount: { type: Number, default: 0 },
      grandTotal: { type: Number, default: 0 },
      createdAt: { type: Date, default: Date.now },
    },
  ],
}, {
  timestamps: true,
});

const Customer = mongoose.model('Customer', customerSchema);
module.exports = Customer;
