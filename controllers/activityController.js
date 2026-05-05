const ActivityLog = require('../models/ActivityLog');

// Get all activity logs with optional pagination/filtering
exports.getActivityLogs = async (req, res) => {
  try {
    const logs = await ActivityLog.find()
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      data: logs
    });
  } catch (error) {
    console.error('Error fetching activity logs:', error);
    res.status(500).json({ success: false, message: 'Server error fetching activity logs' });
  }
};
