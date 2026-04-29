const mongoose = require('mongoose');

const roleSchema = new mongoose.Schema({
  roleName: { type: String, required: true, unique: true },
  notes: { type: String, trim: true, default: '' },
  permissions: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  }
}, { timestamps: true });

module.exports = mongoose.model('Role', roleSchema);
