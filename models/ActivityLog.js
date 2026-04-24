const mongoose = require('mongoose');

const activityLogSchema = new mongoose.Schema({
  logName: {
    type: String,
    required: true,
    trim: true,
  },
  byPersonName: {
    type: String,
    required: true,
    trim: true,
  },
  recordName: {
    type: String,
    required: true,
    trim: true,
  },
  recordType: {
    type: String,
    required: true,
    enum: ['Lead', 'Customer', 'Survey', 'User', 'Assignment'],
    trim: true,
  },
  recordId: {
    type: mongoose.Schema.Types.ObjectId,
  },
}, {
  timestamps: true,
});

const ActivityLog = mongoose.model('ActivityLog', activityLogSchema);
module.exports = ActivityLog;
