const mongoose = require('mongoose');

const serviceSchema = new mongoose.Schema({
  ticketId: {
    type: String,
    unique: true
  },
  customerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Customer',
    required: true
  },
  toFixItems: [
    {
      surveyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Survey' },
      area: { type: String },
      fixtureType: { type: String },
      proposedQty: { type: Number },
      toFix: { type: Number, default: 1 },
      image: { type: String },
      issueNote: { type: String }
    }
  ],
  materialDelivered: {
    type: Boolean,
    default: false
  },
  assignedTo: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  notes: {
    type: String
  },
  status: {
    type: String,
    enum: ['Assigned', 'In Progress', 'Completed'],
    default: 'Assigned'
  }
}, {
  timestamps: true
});

serviceSchema.pre('save', async function(next) {
  if (!this.ticketId) {
    const count = await mongoose.model('Service').countDocuments();
    const year = new Date().getFullYear();
    this.ticketId = `SRV-${year}-${(count + 1).toString().padStart(3, '0')}`;
  }
  next();
});

const Service = mongoose.model('Service', serviceSchema);
module.exports = Service;
