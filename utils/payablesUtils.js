const { enrichAreasWithProducts } = require('./surveyProductUtils');
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
    .map((area) => (area.areaName || area.existingFixtureType || '').trim())
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
  const totals = calculatePayablesFromAreas(enrichedAreas);
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
    confirmedDate: survey.quotationApprovedAt || null,
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

function getPaymentTotals(customer, surveyId, commissionType, calculatedAmount) {
  const record = findCommissionRecord(customer, surveyId, commissionType);
  const amount = roundMoney(calculatedAmount);
  const paid = roundMoney(record?.paidAmount || 0);
  const pending = roundMoney(Math.max(0, amount - paid));

  return { amount, paid, pending };
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
    paidAmount: existing?.paidAmount || 0,
    paymentMethod: existing?.paymentMethod,
    paymentDate: existing?.paymentDate,
    paymentStatus: existing?.paymentStatus || 'payment pending',
    date: existing?.date || new Date(),
  };
}

async function syncPayablesForCustomer(customer) {
  const Survey = require('../models/Survey');
  const surveys = await Survey.find({ customer_id: customer._id }).sort({ createdAt: -1 });

  if (!surveys.length) return customer;

  const nextCommissions = [...(customer.commissions || [])];

  for (const survey of surveys) {
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
  syncPayablesForCustomer,
  roundMoney,
};
