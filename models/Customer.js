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
  verifyStatus: {
    type: String,
    enum: ['pending', 'verified'],
    default: 'pending',
    trim: true,
  },
  commissions: [
    {
      commissionType: { type: String, enum: ['Survey', 'Installation', 'Other'], required: true },
      salesPerson: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
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
    required: true,
    enum: ['New', 'in_progress', 'draft', 'completed'],
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
  material: [
    {
      item_name: { type: String, trim: true },
      issued_qty: { type: Number, default: 0 },
      issued_date: { type: Date, default: Date.now },
      image: { type: String },
    },
  ],
  materialStatus: {
    type: String,
    enum: ['pending', 'verified'],
    default: 'pending',
  },
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
