const Lead = require('../models/Lead');
const Customer = require('../models/Customer');
const Survey = require('../models/Survey');
const ActivityLog = require('../models/ActivityLog');

exports.getAdminDashboardStats = async (req, res) => {
  try {
    const totalActiveLeads = await Lead.countDocuments({
      status: { $nin: ["Lost Leads", "Converted To Customer"] }
    });
    const totalCustomers = await Customer.countDocuments({});
    const submittedSurveys = await Customer.countDocuments({ status: 'completed' });

    // As per user request, these should show 0 for now
    const completedInstallations = 0;
    const completedInspections = 0;
    const activeServices = 0;

    // Fetch recent activity logs
    const activityLog = await ActivityLog.find({})
      .sort({ createdAt: -1 })
      .limit(10);

    return res.status(200).json({
      totalActiveLeads,
      totalCustomers,
      submittedSurveys,
      completedInstallations,
      completedInspections,
      activeServices,
      activityLog
    });
  } catch (error) {
    console.error('Admin dashboard stats error:', error);
    return res.status(500).json({ message: 'Server error fetching dashboard statistics.' });
  }
};
