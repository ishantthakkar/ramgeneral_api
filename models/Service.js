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
  material: [
    {
      item_name: { type: String },
      issued_qty: { type: Number },
      issued_date: { type: Date },
      image: { type: String }
    }
  ],
  materialStatus: {
    type: String,
    enum: ['Pending', 'Delivered', 'Partial'],
    default: 'Pending'
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

serviceSchema.pre('save', async function (next) {
  if (!this.ticketId) {
    try {
      // Find the latest service ticket globally
      const lastService = await mongoose.model('Service').findOne({
        ticketId: { $regex: /^\d+$/ }
      }).sort({ createdAt: -1 });

      let nextNumber = 1;
      if (lastService && lastService.ticketId) {
        const lastNumber = parseInt(lastService.ticketId);
        if (!isNaN(lastNumber)) {
          nextNumber = lastNumber + 1;
        }
      }

      this.ticketId = nextNumber.toString();
    } catch (error) {
      console.error('Error generating ticketId:', error);
      next(error);
    }
  }
  next();
});

const Service = mongoose.model('Service', serviceSchema);
module.exports = Service;
