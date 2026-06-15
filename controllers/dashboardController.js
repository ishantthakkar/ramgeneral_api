const Lead = require('../models/Lead');
const Customer = require('../models/Customer');
const Admin = require('../models/Admin');
const User = require('../models/User');
const Survey = require('../models/Survey');
const ActivityLog = require('../models/ActivityLog');
const { isSalesManagerRole, isSalesPersonRole } = require('../constants/userRoles');
const { surveyQuotationDataFilter } = require('../utils/quotationHelpers');

const WORKFLOW_SURVEY_STATUSES = [
  'submitted',
  'completed',
  'reopened',
  'reopen',
  'pending_edit_approval',
];

async function countScopedSurveyQuotations(userId, admin) {
  const surveyFilter = surveyQuotationDataFilter();

  if (admin) {
    return Survey.countDocuments(surveyFilter);
  }

  const user = await User.findById(userId).select('userRole').lean();
  if (!user) {
    return 0;
  }

  if (isSalesManagerRole(user.userRole)) {
    const teamMembers = await User.find({ reportsTo: userId }).select('_id').lean();
    const teamIds = teamMembers.map((member) => member._id);
    if (!teamIds.length) {
      return 0;
    }

    const customers = await Customer.find({ user_id: { $in: teamIds } }).select('_id').lean();
    const customerIds = customers.map((customer) => customer._id);
    if (!customerIds.length) {
      return 0;
    }

    return Survey.countDocuments({ ...surveyFilter, customer_id: { $in: customerIds } });
  }

  if (isSalesPersonRole(user.userRole)) {
    const customers = await Customer.find({ user_id: userId }).select('_id').lean();
    const customerIds = customers.map((customer) => customer._id);
    if (!customerIds.length) {
      return 0;
    }

    return Survey.countDocuments({ ...surveyFilter, customer_id: { $in: customerIds } });
  }

  return 0;
}

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

exports.getWorkflowStats = async (req, res) => {
  try {
    const userId = req.user.id;
    const admin = await Admin.findById(userId).select('_id').lean();

    const surveyFilter = {
      leadId: { $ne: null },
      $or: [
        { verifyStatus: 'verified' },
        { status: { $in: WORKFLOW_SURVEY_STATUSES } },
      ],
    };

    if (!admin) {
      const user = await User.findById(userId).select('userRole').lean();
      if (user?.userRole === 'Project Manager') {
        surveyFilter.assignedTo = userId;
      }
    }

    const [totalSurveys, totalInstallations, totalInspections] = await Promise.all([
      Customer.countDocuments(surveyFilter),
      Survey.countDocuments({ quotationStatus: 'approved' }),
      Customer.countDocuments({
        material: { $exists: true, $not: { $size: 0 } },
        installationStatus: 'completed',
      }),
    ]);

    const totalQuotations = await countScopedSurveyQuotations(userId, !!admin);

    return res.status(200).json({
      totalSurveys,
      totalQuotations,
      totalInstallations,
      totalInspections,
    });
  } catch (error) {
    console.error('Workflow stats error:', error);
    return res.status(500).json({ message: 'Server error fetching workflow statistics.' });
  }
};
