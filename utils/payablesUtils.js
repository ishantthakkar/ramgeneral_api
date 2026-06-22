const { enrichAreasWithProducts, flattenAreaFixtures } = require('./surveyProductUtils');
const { getGenerateQuotationsForSurvey } = require('./quotationHelpers');
const { isSalesManagerRole } = require('../constants/userRoles');

function parseQuantity(value) {
  const qty = parseFloat(value);
  return Number.isFinite(qty) && qty > 0 ? qty : 0;
}

function parseUnitPrice(area) {
  const fromArea = parseFloat(area.price);
  if (Number.isFinite(fromArea) && fromArea > 0) return fromArea;
  const fromProduct = area.product?.salesPrice ?? area.product?.price;
  const parsed = parseFloat(fromProduct);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function resolveSurveyDisplayName(survey) {
  const surveyName = (survey.areaName || '').trim();
  if (surveyName) return surveyName;

  const areaNames = (survey.areas || [])
    .map((area) => {
      const name = (area.areaName || '').trim();
      if (name) return name;
      const firstFixture = area.fixtures?.[0];
      return (firstFixture?.existingFixtureType || '').trim();
    })
    .filter(Boolean);

  if (areaNames.length === 1) return areaNames[0];
  if (areaNames.length > 1) return areaNames.join(', ');
  return 'Survey';
}

function normalizeAssignRole(value) {
  return String(value || '').trim().toLowerCase().replace(/_/g, ' ');
}

function resolvePopulatedUserName(user) {
  if (!user || typeof user !== 'object') return '';
  return String(user.fullName || user.name || '').trim();
}

function resolveSurveyContractorUser(survey, customer) {
  const surveyContractor = survey?.assignToContractor;
  if (surveyContractor) {
    if (typeof surveyContractor === 'object' && surveyContractor._id) {
      return surveyContractor;
    }
    return surveyContractor;
  }

  const assignedTo = survey?.assignedTo;
  if (assignedTo && typeof assignedTo === 'object' && assignedTo._id) {
    if (normalizeAssignRole(assignedTo.userRole) === 'contractor') {
      return assignedTo;
    }
  }

  const customerContractor = customer?.assignToContractor;
  if (customerContractor) {
    return customerContractor;
  }

  return null;
}

function resolveSurveyContractorName(survey, customer) {
  const contractor = resolveSurveyContractorUser(survey, customer);
  const name = resolvePopulatedUserName(contractor);
  return name || 'Unassigned';
}

function resolveSurveyContractorId(survey, customer) {
  const contractor = resolveSurveyContractorUser(survey, customer);
  if (!contractor) return null;
  if (typeof contractor === 'object' && contractor._id) {
    return contractor._id;
  }
  return contractor;
}

function resolveSurveySalesPersonUser(survey, customer) {
  if (survey?.user_id) return survey.user_id;
  return customer?.user_id || null;
}

function resolveSurveySalesPersonName(survey, customer) {
  const salesPerson = resolveSurveySalesPersonUser(survey, customer);
  const name = resolvePopulatedUserName(salesPerson);
  return name || 'Unassigned';
}

function resolveSurveySalesPersonId(survey, customer) {
  const salesPerson = resolveSurveySalesPersonUser(survey, customer);
  if (!salesPerson) return null;
  if (typeof salesPerson === 'object' && salesPerson._id) {
    return salesPerson._id;
  }
  return salesPerson;
}

function resolveSurveySalesManagerUser(survey, customer) {
  const salesPerson = resolveSurveySalesPersonUser(survey, customer);
  if (salesPerson && typeof salesPerson === 'object') {
    const supervisor = salesPerson.reportsTo;
    if (supervisor) {
      if (typeof supervisor === 'object' && supervisor._id) {
        if (!supervisor.userRole || isSalesManagerRole(supervisor.userRole)) {
          return supervisor;
        }
      } else {
        return supervisor;
      }
    }
  }

  const lead = customer?.leadId;
  if (lead && typeof lead === 'object' && lead.assignedBy) {
    return lead.assignedBy;
  }

  return null;
}

function resolveSurveySalesManagerName(survey, customer) {
  const salesManager = resolveSurveySalesManagerUser(survey, customer);
  const name = resolvePopulatedUserName(salesManager);
  return name || 'Unassigned';
}

function resolveSurveySalesManagerId(survey, customer) {
  const salesManager = resolveSurveySalesManagerUser(survey, customer);
  if (!salesManager) return null;
  if (typeof salesManager === 'object' && salesManager._id) {
    return salesManager._id;
  }
  return salesManager;
}

function getLatestQuotationForSurvey(survey, customer) {
  const quotations = getGenerateQuotationsForSurvey(survey, customer) || [];
  if (!quotations.length) return null;
  return [...quotations].sort((a, b) => {
    const aTime = new Date(a.createdAt || 0).getTime();
    const bTime = new Date(b.createdAt || 0).getTime();
    return bTime - aTime;
  })[0];
}

function resolveProductAgentCommission(product) {
  const agent = parseFloat(product?.agentCommission);
  if (Number.isFinite(agent) && agent >= 0) return agent;
  const legacy = parseFloat(product?.commission);
  return Number.isFinite(legacy) && legacy >= 0 ? legacy : 0;
}

function resolveProductManagerCommission(product) {
  const manager = parseFloat(product?.managerCommission);
  return Number.isFinite(manager) && manager >= 0 ? manager : 0;
}

function calculatePayablesFromAreas(areas) {
  let salesCommission = 0;
  let managerCommission = 0;
  let contractorCommission = 0;
  let quotationAmount = 0;

  for (const area of areas || []) {
    const quantity = parseQuantity(area.proposedQty);
    if (!quantity) continue;

    const unitPrice = parseUnitPrice(area);
    const agentCommission = resolveProductAgentCommission(area.product);
    const productManagerCommission = resolveProductManagerCommission(area.product);
    const installationCost = parseFloat(area.product?.installationCost) || 0;

    quotationAmount += quantity * unitPrice;
    salesCommission += quantity * agentCommission;
    managerCommission += quantity * productManagerCommission;
    contractorCommission += quantity * installationCost;
  }

  return {
    salesCommission: roundMoney(salesCommission),
    managerCommission: roundMoney(managerCommission),
    contractorCommission: roundMoney(contractorCommission),
    quotationAmount: roundMoney(quotationAmount),
  };
}

function roundMoney(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

async function calculateSurveyPayables(survey, customer) {
  const enrichedAreas = await enrichAreasWithProducts(survey.areas || []);
  const totals = calculatePayablesFromAreas(flattenAreaFixtures(enrichedAreas));
  const latestQuotation = getLatestQuotationForSurvey(survey, customer);

  const quotationAmount =
    latestQuotation?.grandTotal > 0
      ? roundMoney(latestQuotation.grandTotal)
      : latestQuotation?.subtotal > 0
        ? roundMoney(latestQuotation.subtotal)
        : totals.quotationAmount;

  return {
    ...totals,
    quotationAmount,
    quotationNumber: latestQuotation?.quotationNumber || '',
    confirmedDate: survey.quotationApprovedAt || survey.confirmDate || null,
    surveyName: resolveSurveyDisplayName(survey),
  };
}

function getInstallDate(customer) {
  const materials = customer.material || [];
  if (!materials.length) return null;

  const dates = materials
    .map((item) => item.issued_date)
    .filter(Boolean)
    .map((date) => new Date(date))
    .filter((date) => !Number.isNaN(date.getTime()));

  if (!dates.length) return null;
  return new Date(Math.max(...dates.map((date) => date.getTime())));
}

function findCommissionRecord(customer, surveyId, commissionType) {
  const surveyKey = surveyId?.toString?.() || String(surveyId || '');
  return (customer.commissions || []).find((entry) => {
    const entrySurveyId = entry.surveyId?.toString?.() || String(entry.surveyId || '');
    return entrySurveyId === surveyKey && entry.commissionType === commissionType;
  });
}

function sumCommissionPayments(record) {
  if (!record) return 0;
  const fromPayments = (record.payments || []).reduce(
    (total, payment) => total + (parseFloat(payment.amount) || 0),
    0
  );
  if (fromPayments > 0) return roundMoney(fromPayments);
  return roundMoney(record.paidAmount || 0);
}

function isProjectAdminApproved(customer) {
  return String(customer?.adminApproval || '').trim().toLowerCase() === 'approved';
}

function isInvoiceFullyPaid(survey) {
  const status = String(survey?.invoiceStatus || '').trim().toLowerCase();
  return status === 'fully_paid' || status === 'fully paid';
}

function getCommissionEligibleAmount(commissionType, totalAmount, customer, survey) {
  const total = roundMoney(totalAmount);

  if (commissionType === 'Installation') {
    return total;
  }

  if (commissionType === 'Sales Manager') {
    return isInvoiceFullyPaid(survey) ? total : 0;
  }

  if (commissionType === 'Survey') {
    let eligible = 0;
    if (isProjectAdminApproved(customer)) {
      eligible += roundMoney(total * 0.5);
    }
    if (isInvoiceFullyPaid(survey)) {
      eligible += roundMoney(total * 0.5);
    }
    return roundMoney(eligible);
  }

  return total;
}

function getCommissionMilestones(commissionType, totalAmount, customer, survey) {
  const total = roundMoney(totalAmount);

  if (commissionType === 'Survey') {
    const half = roundMoney(total * 0.5);
    const projectApproved = isProjectAdminApproved(customer);
    const invoiceFullyPaid = isInvoiceFullyPaid(survey);

    return {
      projectApproved,
      invoiceFullyPaid,
      schedule: [
        {
          key: 'project_approval',
          label: 'Project admin approval',
          share: '50%',
          amount: half,
          unlocked: projectApproved,
        },
        {
          key: 'invoice_paid',
          label: 'Invoice fully paid',
          share: '50%',
          amount: half,
          unlocked: invoiceFullyPaid,
        },
      ],
    };
  }

  if (commissionType === 'Sales Manager') {
    const invoiceFullyPaid = isInvoiceFullyPaid(survey);
    return {
      projectApproved: false,
      invoiceFullyPaid,
      schedule: [
        {
          key: 'invoice_paid',
          label: 'Invoice fully paid',
          share: '100%',
          amount: total,
          unlocked: invoiceFullyPaid,
        },
      ],
    };
  }

  return {
    projectApproved: isProjectAdminApproved(customer),
    invoiceFullyPaid: isInvoiceFullyPaid(survey),
    schedule: [],
  };
}

function getPaymentTotals(customer, survey, commissionType, calculatedAmount) {
  const surveyId = survey?._id || survey;
  const record = findCommissionRecord(customer, surveyId, commissionType);
  const amount = roundMoney(calculatedAmount);
  const eligible = getCommissionEligibleAmount(commissionType, amount, customer, survey);
  const paid = sumCommissionPayments(record);
  const pending = roundMoney(Math.max(0, eligible - paid));
  const locked = roundMoney(Math.max(0, amount - eligible));
  const balance = roundMoney(Math.max(0, amount - paid));

  return { amount, eligible, paid, pending, locked, balance, record };
}

const VALID_PAYMENT_METHODS = [
  'Cash',
  'ACH Transfer',
  'Wire Transfer',
  'Check',
  'Credit Card',
  'Debit Card',
  'PayPal',
  'Stripe',
  'Other',
];

function normalizePayableFor(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (
    normalized === 'contractor' ||
    normalized === 'contractors' ||
    normalized === 'installation'
  ) {
    return 'Installation';
  }
  if (
    normalized === 'sales manager' ||
    normalized === 'salesmanager' ||
    normalized === 'sales-manager' ||
    normalized === 'manager'
  ) {
    return 'Sales Manager';
  }
  return 'Survey';
}

function resolvePayableAmount(payables, commissionType) {
  if (commissionType === 'Installation') return payables.contractorCommission;
  if (commissionType === 'Sales Manager') return payables.managerCommission;
  return payables.salesCommission;
}

async function addPaymentToCommission(customer, { surveyId, payableFor, amount, paymentMethod, paymentDate, note }) {
  const Survey = require('../models/Survey');
  const survey = await Survey.findOne({ _id: surveyId, customer_id: customer._id });

  if (!survey) {
    const error = new Error('Survey not found for this customer.');
    error.statusCode = 404;
    throw error;
  }

  if (!isPayableSurvey(survey)) {
    const error = new Error('Quotation must be approved before recording payments.');
    error.statusCode = 400;
    throw error;
  }

  const type = normalizePayableFor(payableFor);
  const payables = await calculateSurveyPayables(survey, customer);
  const dynamicAmount = resolvePayableAmount(payables, type);

  await ensureCustomerPayableRelations(customer);
  await syncPayablesForCustomer(customer);

  const commissionIndex = (customer.commissions || []).findIndex((entry) => {
    const entrySurveyId = entry.surveyId?.toString?.() || String(entry.surveyId || '');
    return entrySurveyId === survey._id.toString() && entry.commissionType === type;
  });

  if (commissionIndex < 0) {
    const error = new Error('Commission record not found for this survey.');
    error.statusCode = 404;
    throw error;
  }

  const existing = customer.commissions[commissionIndex];
  const plain = existing?.toObject?.() || { ...existing };
  const paymentAmount = roundMoney(parseFloat(amount));

  if (!Number.isFinite(paymentAmount) || paymentAmount <= 0) {
    const error = new Error('Payment amount must be greater than 0.');
    error.statusCode = 400;
    throw error;
  }

  if (!paymentMethod || !VALID_PAYMENT_METHODS.includes(paymentMethod)) {
    const error = new Error('A valid payment method is required.');
    error.statusCode = 400;
    throw error;
  }

  const paidSoFar = sumCommissionPayments(plain);
  const eligibleAmount = getCommissionEligibleAmount(type, dynamicAmount, customer, survey);
  const pendingBefore = roundMoney(Math.max(0, eligibleAmount - paidSoFar));

  if (eligibleAmount <= 0) {
    const error = new Error('No commission amount is payable yet. Required milestones have not been reached.');
    error.statusCode = 400;
    throw error;
  }

  if (paymentAmount > pendingBefore) {
    const error = new Error(
      `Payment exceeds payable commission. Maximum payable amount is ${pendingBefore}.`
    );
    error.statusCode = 400;
    throw error;
  }

  const nextPayment = {
    amount: paymentAmount,
    paymentMethod,
    note: String(note || '').trim(),
    paymentDate: paymentDate ? new Date(paymentDate) : new Date(),
    createdAt: new Date(),
  };

  const payments = [...(plain.payments || []), nextPayment];
  const paid = roundMoney(paidSoFar + paymentAmount);
  const totals = getPaymentTotals(customer, survey, type, dynamicAmount);

  customer.commissions[commissionIndex] = {
    ...plain,
    surveyId: survey._id,
    commissionType: type,
    amount: dynamicAmount,
    payments,
    paidAmount: paid,
    paymentMethod,
    paymentDate: nextPayment.paymentDate,
    paymentStatus: paid >= dynamicAmount ? 'paid' : 'payment pending',
  };

  return {
    commission: customer.commissions[commissionIndex],
    payment: nextPayment,
    dynamicAmount,
    eligible: totals.eligible,
    paid,
    pending: totals.pending,
    locked: totals.locked,
    balance: totals.balance,
    milestones: getCommissionMilestones(type, dynamicAmount, customer, survey),
    quotationNumber: payables.quotationNumber,
    quotationAmount: payables.quotationAmount,
  };
}

function buildCommissionEntry({
  surveyId,
  commissionType,
  amount,
  salesPerson,
  salesManager,
  contractor,
  existing,
}) {
  return {
    surveyId,
    commissionType,
    amount: roundMoney(amount),
    salesPerson: commissionType === 'Survey' ? salesPerson || existing?.salesPerson : undefined,
    salesManager:
      commissionType === 'Sales Manager' ? salesManager || existing?.salesManager : undefined,
    contractor: commissionType === 'Installation' ? contractor || existing?.contractor : undefined,
    paidAmount: existing ? sumCommissionPayments(existing) : 0,
    payments: existing?.payments || [],
    paymentMethod: existing?.paymentMethod,
    paymentDate: existing?.paymentDate,
    paymentStatus: existing?.paymentStatus || 'payment pending',
    date: existing?.date || new Date(),
  };
}

function isPayableSurvey(survey) {
  return String(survey?.quotationStatus || '').toLowerCase() === 'approved';
}

async function ensureCustomerPayableRelations(customer) {
  if (!customer.populated('user_id')) {
    await customer.populate({
      path: 'user_id',
      select: 'fullName email name userRole',
      populate: { path: 'reportsTo', select: 'fullName email userRole' },
    });
  }

  if (customer.leadId && !customer.populated('leadId')) {
    await customer.populate({
      path: 'leadId',
      select: 'assignedBy',
      populate: { path: 'assignedBy', select: 'fullName email userRole' },
    });
  }
}

async function syncPayablesForCustomer(customer) {
  const Survey = require('../models/Survey');
  await ensureCustomerPayableRelations(customer);

  const surveys = await Survey.find({ customer_id: customer._id })
    .populate('assignedTo', 'fullName email userRole')
    .populate('assignToContractor', 'fullName email userRole')
    .populate('user_id', 'fullName email name')
    .sort({ createdAt: -1 });

  if (!surveys.length) return customer;

  const payableSurveys = surveys.filter(isPayableSurvey);
  const payableSurveyIds = new Set(
    payableSurveys.map((survey) => survey._id.toString())
  );

  const nextCommissions = (customer.commissions || []).filter((entry) => {
    const entrySurveyId = entry.surveyId?.toString?.() || String(entry.surveyId || '');
    return payableSurveyIds.has(entrySurveyId);
  });

  for (const survey of payableSurveys) {
    const payables = await calculateSurveyPayables(survey, customer);
    const surveyId = survey._id;

    const surveyTypes = [
      {
        commissionType: 'Survey',
        amount: payables.salesCommission,
        salesPerson: resolveSurveySalesPersonId(survey, customer),
      },
      {
        commissionType: 'Sales Manager',
        amount: payables.managerCommission,
        salesManager: resolveSurveySalesManagerId(survey, customer),
      },
      {
        commissionType: 'Installation',
        amount: payables.contractorCommission,
        contractor: resolveSurveyContractorId(survey, customer),
      },
    ];

    for (const item of surveyTypes) {
      const index = nextCommissions.findIndex((entry) => {
        const entrySurveyId = entry.surveyId?.toString?.() || String(entry.surveyId || '');
        return entrySurveyId === surveyId.toString() && entry.commissionType === item.commissionType;
      });

      const existing = index >= 0 ? nextCommissions[index] : null;
      const entry = buildCommissionEntry({
        surveyId,
        commissionType: item.commissionType,
        amount: item.amount,
        salesPerson: item.salesPerson,
        salesManager: item.salesManager,
        contractor: item.contractor,
        existing,
      });

      if (index >= 0) {
        const plain = existing?.toObject?.() || { ...existing };
        nextCommissions[index] = { ...plain, ...entry };
      } else {
        nextCommissions.push(entry);
      }
    }
  }

  customer.commissions = nextCommissions;
  return customer;
}

module.exports = {
  calculatePayablesFromAreas,
  calculateSurveyPayables,
  resolveSurveyDisplayName,
  resolveSurveyContractorName,
  resolveSurveySalesPersonName,
  resolveSurveySalesManagerName,
  resolvePayableAmount,
  isProjectAdminApproved,
  isInvoiceFullyPaid,
  getCommissionEligibleAmount,
  getCommissionMilestones,
  getInstallDate,
  getPaymentTotals,
  findCommissionRecord,
  isPayableSurvey,
  syncPayablesForCustomer,
  sumCommissionPayments,
  addPaymentToCommission,
  normalizePayableFor,
  roundMoney,
  VALID_PAYMENT_METHODS,
};
