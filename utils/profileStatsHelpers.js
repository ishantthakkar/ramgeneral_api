const Lead = require('../models/Lead');
const Customer = require('../models/Customer');
const Survey = require('../models/Survey');
const User = require('../models/User');
const {
  isSalesPersonRole,
  isSalesManagerRole,
  SALES_PERSON_ROLE_VARIANTS,
} = require('../constants/userRoles');

const normalizeStatus = (value) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/_/g, ' ');

async function getCustomerIdsForUserIds(userIds) {
  const ids = Array.isArray(userIds) ? userIds : [userIds];
  if (!ids.length) return [];

  return Customer.distinct('_id', { user_id: { $in: ids } });
}

async function getSalesManagerTeamUserIds(managerId) {
  const teamMembers = await User.find({ reportsTo: managerId }).select('_id').lean();
  return [managerId, ...teamMembers.map((member) => member._id)];
}

async function getSalesPersonStats(userId) {
  const customerIds = await getCustomerIdsForUserIds(userId);

  const [
    totalLeads,
    converted,
    lost,
    completedSurvey,
    pendingSurvey,
    inProgressSurvey,
  ] = await Promise.all([
    Lead.countDocuments({ user_id: userId }),
    Lead.countDocuments({
      user_id: userId,
      $or: [{ status: 'Converted To Customer' }, { convertedToCustomer: true }],
    }),
    Lead.countDocuments({ user_id: userId, status: 'Lost Leads' }),
    customerIds.length
      ? Survey.countDocuments({
          customer_id: { $in: customerIds },
          $or: [
            { confirmDate: { $ne: null } },
            { status: { $in: ['Completed', 'completed', 'verified'] } },
          ],
        })
      : 0,
    customerIds.length
      ? Survey.countDocuments({
          customer_id: { $in: customerIds },
          $or: [
            { status: { $in: ['Draft', 'draft', 'pending'] } },
            { status: { $exists: false } },
            { status: '' },
          ],
        })
      : 0,
    customerIds.length
      ? Survey.countDocuments({
          customer_id: { $in: customerIds },
          status: { $in: ['In Progress', 'in_progress'] },
        })
      : 0,
  ]);

  return {
    totalLeads,
    converted,
    lost,
    completedSurvey,
    pendingSurvey,
    inProgressSurvey,
  };
}

async function getSalesManagerStats(managerId) {
  const teamUserIds = await getSalesManagerTeamUserIds(managerId);
  const customerIds = await getCustomerIdsForUserIds(teamUserIds);

  const [salesPerson, submittedSurvey, reopenSurvey, verifiedSurvey] = await Promise.all([
    User.countDocuments({
      reportsTo: managerId,
      userRole: { $in: SALES_PERSON_ROLE_VARIANTS },
    }),
    customerIds.length
      ? Survey.countDocuments({
          customer_id: { $in: customerIds },
          status: { $in: ['submitted', 'Submitted'] },
        })
      : 0,
    customerIds.length
      ? Survey.countDocuments({
          customer_id: { $in: customerIds },
          status: { $in: ['reopen', 'reopened', 'Reopen', 'Reopened'] },
        })
      : 0,
    customerIds.length
      ? Survey.countDocuments({
          customer_id: { $in: customerIds },
          $or: [
            { confirmDate: { $ne: null } },
            { status: { $in: ['Completed', 'completed', 'verified'] } },
          ],
        })
      : 0,
  ]);

  return {
    salesPerson,
    submittedSurvey,
    reopenSurvey,
    verifiedSurvey,
  };
}

async function countPmSurveysWithCustomerInstallationStatus(pmId, installationStatus) {
  const surveys = await Survey.find({ assignedTo: pmId }).select('customer_id').lean();
  if (!surveys.length) return 0;

  const customerIds = [
    ...new Set(
      surveys
        .map((survey) => survey.customer_id?.toString())
        .filter(Boolean)
    ),
  ];

  if (!customerIds.length) return 0;

  const matchingCustomers = await Customer.countDocuments({
    _id: { $in: customerIds },
    installationStatus,
  });

  return matchingCustomers;
}

async function getProjectManagerStats(pmId) {
  const pmFilter = { assignedTo: pmId };

  const [
    totalProject,
    installationDone,
    installationReopen,
    pendingInspection,
    inProgressInspection,
    completedInspection,
    reopenInspection,
  ] = await Promise.all([
    Survey.countDocuments(pmFilter),
    Survey.countDocuments({
      ...pmFilter,
      installationStatus: { $in: ['completed', 'submitted'] },
    }),
    countPmSurveysWithCustomerInstallationStatus(pmId, 'reopen'),
    Survey.countDocuments({ ...pmFilter, inspectionStatus: 'to-do' }),
    Survey.countDocuments({ ...pmFilter, inspectionStatus: 'in_progress' }),
    Survey.countDocuments({
      ...pmFilter,
      inspectionStatus: { $in: ['verified', 'confirm'] },
    }),
    Survey.countDocuments({ ...pmFilter, inspectionStatus: 'reopen' }),
  ]);

  return {
    totalProject,
    installationDone,
    installationReopen,
    pendingInspection,
    inProgressInspection,
    completedInspection,
    reopenInspection,
  };
}

async function countContractorSurveysWithCustomerInstallationStatus(contractorId, installationStatus) {
  const surveys = await Survey.find({ assignToContractor: contractorId }).select('customer_id').lean();
  if (!surveys.length) return 0;

  const customerIds = [
    ...new Set(
      surveys
        .map((survey) => survey.customer_id?.toString())
        .filter(Boolean)
    ),
  ];

  if (!customerIds.length) return 0;

  return Customer.countDocuments({
    _id: { $in: customerIds },
    installationStatus,
  });
}

async function getContractorStats(contractorId) {
  const contractorFilter = { assignToContractor: contractorId };

  const [
    installationSubmitted,
    installationReopen,
    installationInProgress,
    installationToDo,
  ] = await Promise.all([
    Survey.countDocuments({ ...contractorFilter, installationStatus: 'submitted' }),
    countContractorSurveysWithCustomerInstallationStatus(contractorId, 'reopen'),
    Survey.countDocuments({
      ...contractorFilter,
      installationStatus: { $in: ['in_progress', 'start', 'continue'] },
    }),
    Survey.countDocuments({
      ...contractorFilter,
      installationStatus: { $nin: ['submitted', 'in_progress', 'start', 'continue', 'completed'] },
    }),
  ]);

  return {
    installationSubmitted,
    installationReopen,
    installationInProgress,
    installationToDo,
  };
}

async function getProfileStatsForUser(user) {
  if (!user?._id) return {};

  const userId = user._id;
  const role = normalizeStatus(user.userRole);

  if (isSalesPersonRole(user.userRole) || role === 'sales person') {
    return getSalesPersonStats(userId);
  }

  if (isSalesManagerRole(user.userRole) || role === 'sales manager') {
    return getSalesManagerStats(userId);
  }

  if (role === 'project manager') {
    return getProjectManagerStats(userId);
  }

  if (role === 'contractor') {
    return getContractorStats(userId);
  }

  return {};
}

module.exports = {
  getProfileStatsForUser,
  getSalesPersonStats,
  getSalesManagerStats,
  getProjectManagerStats,
  getContractorStats,
};
