const { enrichAreasWithProducts, flattenAreaFixtures } = require('./surveyProductUtils');
const { getGenerateQuotationsForSurvey } = require('./quotationHelpers');

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

function getLatestQuotationForSurvey(survey, customer) {
  const quotations = getGenerateQuotationsForSurvey(survey, customer) || [];
  if (!quotations.length) return null;
  return [...quotations].sort((a, b) => {
    const aTime = new Date(a.createdAt || 0).getTime();
    const bTime = new Date(b.createdAt || 0).getTime();
    return bTime - aTime;
  })[0];
}

function calculatePayablesFromAreas(areas) {
  let salesCommission = 0;
  let contractorCommission = 0;
  let quotationAmount = 0;

  for (const area of areas || []) {
    const quantity = parseQuantity(area.proposedQty);
    if (!quantity) continue;

    const unitPrice = parseUnitPrice(area);
    const productCommission = parseFloat(area.product?.commission) || 0;
    const installationCost = parseFloat(area.product?.installationCost) || 0;

    quotationAmount += quantity * unitPrice;
    salesCommission += quantity * productCommission;
    contractorCommission += quantity * installationCost;
  }

  return {
    salesCommission: roundMoney(salesCommission),
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
    confirmedDate: survey.confirmDate || survey.quotationApprovedAt || null,
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

function getPaymentTotals(customer, surveyId, commissionType, calculatedAmount) {
  const record = findCommissionRecord(customer, surveyId, commissionType);
  const amount = roundMoney(calculatedAmount);
  const paid = sumCommissionPayments(record);
  const pending = roundMoney(Math.max(0, amount - paid));

  return { amount, paid, pending, record };
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
  return 'Survey';
}

async function addPaymentToCommission(customer, { surveyId, payableFor, amount, paymentMethod, paymentDate }) {
  const Survey = require('../models/Survey');
  const survey = await Survey.findOne({ _id: surveyId, customer_id: customer._id });

  if (!survey) {
    const error = new Error('Survey not found for this customer.');
    error.statusCode = 404;
    throw error;
  }

  if (!isSurveyVerified(survey)) {
    const error = new Error('Survey must be verified before recording payments.');
    error.statusCode = 400;
    throw error;
  }

  const type = normalizePayableFor(payableFor);
  const payables = await calculateSurveyPayables(survey, customer);
  const dynamicAmount =
    type === 'Installation' ? payables.contractorCommission : payables.salesCommission;

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
  const pendingBefore = roundMoney(Math.max(0, dynamicAmount - paidSoFar));

  if (paymentAmount > pendingBefore) {
    const error = new Error(
      `Payment exceeds pending commission. Maximum payable amount is ${pendingBefore}.`
    );
    error.statusCode = 400;
    throw error;
  }

  const nextPayment = {
    amount: paymentAmount,
    paymentMethod,
    paymentDate: paymentDate ? new Date(paymentDate) : new Date(),
    createdAt: new Date(),
  };

  const payments = [...(plain.payments || []), nextPayment];
  const paid = roundMoney(paidSoFar + paymentAmount);
  const pending = roundMoney(Math.max(0, dynamicAmount - paid));

  customer.commissions[commissionIndex] = {
    ...plain,
    surveyId: survey._id,
    commissionType: type,
    amount: dynamicAmount,
    payments,
    paidAmount: paid,
    paymentMethod,
    paymentDate: nextPayment.paymentDate,
    paymentStatus: pending <= 0 ? 'paid' : 'payment pending',
  };

  return {
    commission: customer.commissions[commissionIndex],
    payment: nextPayment,
    dynamicAmount,
    paid,
    pending,
    quotationNumber: payables.quotationNumber,
    quotationAmount: payables.quotationAmount,
  };
}

function buildCommissionEntry({
  surveyId,
  commissionType,
  amount,
  salesPerson,
  contractor,
  existing,
}) {
  return {
    surveyId,
    commissionType,
    amount: roundMoney(amount),
    salesPerson: commissionType === 'Survey' ? salesPerson || existing?.salesPerson : undefined,
    contractor: commissionType === 'Installation' ? contractor || existing?.contractor : undefined,
    paidAmount: existing ? sumCommissionPayments(existing) : 0,
    payments: existing?.payments || [],
    paymentMethod: existing?.paymentMethod,
    paymentDate: existing?.paymentDate,
    paymentStatus: existing?.paymentStatus || 'payment pending',
    date: existing?.date || new Date(),
  };
}

function isSurveyVerified(survey) {
  if (!survey?.confirmDate) return false;
  const date = new Date(survey.confirmDate);
  return !Number.isNaN(date.getTime());
}

async function syncPayablesForCustomer(customer) {
  const Survey = require('../models/Survey');
  const surveys = await Survey.find({ customer_id: customer._id }).sort({ createdAt: -1 });

  if (!surveys.length) return customer;

  const verifiedSurveys = surveys.filter(isSurveyVerified);
  const verifiedSurveyIds = new Set(
    verifiedSurveys.map((survey) => survey._id.toString())
  );

  const nextCommissions = (customer.commissions || []).filter((entry) => {
    const entrySurveyId = entry.surveyId?.toString?.() || String(entry.surveyId || '');
    return verifiedSurveyIds.has(entrySurveyId);
  });

  for (const survey of verifiedSurveys) {
    const payables = await calculateSurveyPayables(survey, customer);
    const surveyId = survey._id;

    const surveyTypes = [
      {
        commissionType: 'Survey',
        amount: payables.salesCommission,
        salesPerson: customer.user_id,
      },
      {
        commissionType: 'Installation',
        amount: payables.contractorCommission,
        contractor: customer.assignToContractor,
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
  getInstallDate,
  getPaymentTotals,
  findCommissionRecord,
  isSurveyVerified,
  syncPayablesForCustomer,
  sumCommissionPayments,
  addPaymentToCommission,
  normalizePayableFor,
  roundMoney,
  VALID_PAYMENT_METHODS,
};
