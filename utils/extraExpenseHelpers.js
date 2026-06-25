const API_BASE_URL = process.env.API_BASE_URL || 'https://ramgeneral-api.onrender.com';

const VALID_EXTRA_EXPENSE_PAYMENT_METHODS = [
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

function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function tryParseJson(value) {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed) return value;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function parseExtraExpensesInput(value) {
  if (value === undefined || value === null || value === '') return [];
  const parsed = tryParseJson(value);
  if (!Array.isArray(parsed)) return null;

  return parsed.map((item) => ({
    description: String(item?.description ?? item?.Description ?? '').trim(),
    price: Number.parseFloat(item?.price ?? item?.Price ?? 0) || 0,
    approvedAmount: 0,
  }));
}

function parseExtraExpensesApprovalInput(value) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = tryParseJson(value);
  if (!Array.isArray(parsed)) return null;

  return parsed.map((item) => ({
    description: String(item?.description ?? item?.Description ?? '').trim(),
    price: Number.parseFloat(item?.price ?? item?.Price ?? 0) || 0,
    approvedAmount:
      Number.parseFloat(item?.approvedAmount ?? item?.approved_amount ?? item?.adminApprovedAmount ?? 0) ||
      0,
  }));
}

function sumExtraExpenses(extraExpenses) {
  return (extraExpenses || []).reduce((total, item) => total + (Number(item?.price) || 0), 0);
}

function sumApprovedExtraExpenses(extraExpenses) {
  return (extraExpenses || []).reduce(
    (total, item) => total + (Number(item?.approvedAmount) || 0),
    0
  );
}

function coerceUploadReceipts(value) {
  if (value === undefined || value === null) return [];
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return [];
    const parsed = tryParseJson(trimmed);
    if (Array.isArray(parsed)) {
      return coerceUploadReceipts(parsed);
    }
    return [trimmed];
  }
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === 'string') return item.trim();
        if (item && typeof item === 'object') {
          return String(item.filename || item.pdfName || item.url || '').trim();
        }
        return '';
      })
      .filter(Boolean);
  }
  return [];
}

function toReceiptUrl(filename, baseUrl = API_BASE_URL) {
  const name = String(filename || '').trim();
  if (!name) return '';
  if (name.startsWith('http://') || name.startsWith('https://')) return name;
  return `${baseUrl}/uploads/surveys/receipts/${name}`;
}

function formatUploadReceiptsForResponse(uploadReceipts, baseUrl = API_BASE_URL) {
  return coerceUploadReceipts(uploadReceipts).map((filename) => toReceiptUrl(filename, baseUrl));
}

function formatExtraExpensesForResponse(survey) {
  const surveyPlain = survey?.toObject ? survey.toObject() : survey;
  const extraExpenses = (surveyPlain.extraExpenses || []).map((item) => ({
    description: item.description || '',
    price: Number(item.price) || 0,
    approvedAmount: Number(item.approvedAmount) || 0,
  }));
  const uploadReceipts = formatUploadReceiptsForResponse(surveyPlain.uploadReceipts);
  const totalAmount = Number(surveyPlain.extraExpensesTotalAmount) || 0;
  const adminApprovedTotal = sumApprovedExtraExpenses(extraExpenses);

  return {
    survey_id: surveyPlain._id,
    extraExpenses,
    totalAmount,
    adminApprovedTotal,
    uploadReceipts,
    uploadReceipt: uploadReceipts[0] || '',
    adminApprovalStatus: surveyPlain.adminApprovalStatus || 'pending',
  };
}

function sumExtraExpensePayments(survey) {
  const surveyPlain = survey?.toObject ? survey.toObject() : survey;
  const payments = surveyPlain.extraExpensePayments || [];
  return payments.reduce((total, item) => total + (Number(item?.amount) || 0), 0);
}

function getExtraExpensePayableTotals(survey) {
  const surveyPlain = survey?.toObject ? survey.toObject() : survey;
  const approvedTotal = roundMoney(sumApprovedExtraExpenses(surveyPlain.extraExpenses || []));
  const paid = roundMoney(sumExtraExpensePayments(surveyPlain));
  const pending = roundMoney(Math.max(0, approvedTotal - paid));

  return {
    approvedTotal,
    paid,
    pending,
    balance: pending,
  };
}

async function addExtraExpensePayment(
  survey,
  { amount, paymentMethod, paymentDate, note }
) {
  if (!survey) {
    const error = new Error('Survey not found.');
    error.statusCode = 404;
    throw error;
  }

  if (String(survey.adminApprovalStatus || '').toLowerCase() !== 'approved') {
    const error = new Error('Extra expenses must be approved before recording payments.');
    error.statusCode = 400;
    throw error;
  }

  const paymentAmount = roundMoney(parseFloat(amount));
  if (!Number.isFinite(paymentAmount) || paymentAmount <= 0) {
    const error = new Error('Payment amount must be greater than 0.');
    error.statusCode = 400;
    throw error;
  }

  const method = String(paymentMethod || '').trim();
  if (!VALID_EXTRA_EXPENSE_PAYMENT_METHODS.includes(method)) {
    const error = new Error('Valid paymentMethod is required.');
    error.statusCode = 400;
    throw error;
  }

  const totals = getExtraExpensePayableTotals(survey);
  if (paymentAmount > totals.pending) {
    const error = new Error(
      `Payment cannot exceed pending extra expense balance of ${totals.pending}.`
    );
    error.statusCode = 400;
    throw error;
  }

  const parsedDate = paymentDate ? new Date(paymentDate) : new Date();
  if (Number.isNaN(parsedDate.getTime())) {
    const error = new Error('Valid paymentDate is required.');
    error.statusCode = 400;
    throw error;
  }

  if (!Array.isArray(survey.extraExpensePayments)) {
    survey.extraExpensePayments = [];
  }

  survey.extraExpensePayments.push({
    amount: paymentAmount,
    paymentMethod: method,
    note: String(note || '').trim(),
    paymentDate: parsedDate,
    createdAt: new Date(),
  });
  survey.markModified('extraExpensePayments');
  await survey.save();

  return getExtraExpensePayableTotals(survey);
}

module.exports = {
  parseExtraExpensesInput,
  parseExtraExpensesApprovalInput,
  sumExtraExpenses,
  sumApprovedExtraExpenses,
  sumExtraExpensePayments,
  getExtraExpensePayableTotals,
  addExtraExpensePayment,
  VALID_EXTRA_EXPENSE_PAYMENT_METHODS,
  coerceUploadReceipts,
  toReceiptUrl,
  formatUploadReceiptsForResponse,
  formatExtraExpensesForResponse,
};
