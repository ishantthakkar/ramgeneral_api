const ActivityLog = require('../models/ActivityLog');
const User = require('../models/User');
const Admin = require('../models/Admin');

/**
 * Creates an activity log entry.
 * @param {string} logName - Type of action (e.g., 'Lead Created')
 * @param {string} userId - ID of the user performing the action
 * @param {string} recordName - Name of the affected record (e.g., Lead Name)
 * @param {string} recordType - Type of record ('Lead', 'Customer', etc.)
 * @param {string} recordId - ID of the affected record
 */
const createLog = async (logName, userId, recordName, recordType, recordId) => {
  try {
    // Try to find the person in User or Admin collection
    let person = await User.findById(userId);
    let personName = person ? person.fullName : 'System';

    if (!person) {
      person = await Admin.findById(userId);
      personName = person ? person.email : 'System';
    }

    await ActivityLog.create({
      logName,
      byPersonName: personName,
      recordName,
      recordType,
      recordId
    });
  } catch (error) {
    console.error('Error creating activity log:', error);
  }
};

module.exports = { createLog };
