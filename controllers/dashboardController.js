const Lead = require('../models/Lead');
const Customer = require('../models/Customer');
const Admin = require('../models/Admin');
const User = require('../models/User');
const Survey = require('../models/Survey');
const Service = require('../models/Service');
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

const normalizeWorkflowSurveyStatus = (value) =>
  (value || '').toString().trim().toLowerCase();

async function countWorkflowSurveys(userId, admin) {
  const customerFilter = {
    leadId: { $ne: null },
    $or: [
      { verifyStatus: 'verified' },
      { status: { $in: WORKFLOW_SURVEY_STATUSES } },
    ],
  };

  if (!admin) {
    const user = await User.findById(userId).select('userRole').lean();
    if (user?.userRole === 'Project Manager') {
      customerFilter.assignedTo = userId;
    }
  }

  const customers = await Customer.find(customerFilter).select('_id verifyStatus').lean();
  const customerIds = customers.map((customer) => customer._id);
  if (!customerIds.length) {
    return 0;
  }

  const verifiedCustomerIds = new Set(
    customers
      .filter((customer) => customer.verifyStatus === 'verified')
      .map((customer) => customer._id.toString())
  );

  const surveys = await Survey.find({ customer_id: { $in: customerIds } })
    .select('customer_id status confirmDate')
    .lean();

  return surveys.filter((survey) => {
    const customerId = survey.customer_id?.toString?.() || '';
    if (verifiedCustomerIds.has(customerId)) {
      return true;
    }
    if (survey.confirmDate) {
      return true;
    }
    return WORKFLOW_SURVEY_STATUSES.includes(normalizeWorkflowSurveyStatus(survey.status));
  }).length;
}

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
    const [
      totalActiveLeads,
      totalCustomers,
      submittedSurveys,
      completedInstallations,
      completedInspections,
      activeServices,
    ] = await Promise.all([
      Lead.countDocuments({
        status: { $nin: ['Lost Leads', 'Converted To Customer'] },
      }),
      Customer.countDocuments({}),
      Survey.countDocuments({
        $or: [
          { status: { $in: ['submitted', 'completed', 'Submitted', 'Completed', 'reopen', 'reopened', 'pending_edit_approval'] } },
          { confirmDate: { $ne: null } },
        ],
      }),
      Survey.countDocuments({
        installationStatus: { $in: ['completed', 'submitted'] },
      }),
      Survey.countDocuments({
        inspectionStatus: 'verified',
      }),
      Service.countDocuments({
        status: { $in: ['Assigned', 'In Progress'] },
      }),
    ]);

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

    const [totalSurveys, totalInstallations, totalInspections] = await Promise.all([
      countWorkflowSurveys(userId, admin),
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
