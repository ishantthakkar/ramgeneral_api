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

function emptyExpenses() {
  return {
    expenseItem: [],
    notes: '',
    totalAmount: 0,
    adminExpenseApprovalStatus: 'pending',
    adminApprovalAmount: 0,
    receipt: [],
  };
}

function coerceExpenseItem(item) {
  const plain = item?.toObject ? item.toObject() : item;
  return {
    itemName: String(plain?.itemName ?? plain?.item_name ?? plain?.description ?? plain?.Description ?? '').trim(),
    price: Number.parseFloat(plain?.price ?? plain?.Price ?? 0) || 0,
    approvedAmount: Number.parseFloat(plain?.approvedAmount ?? plain?.approved_amount ?? 0) || 0,
  };
}

function parseExpenseItemsInput(value) {
  if (value === undefined || value === null || value === '') return [];
  const parsed = tryParseJson(value);
  if (!Array.isArray(parsed)) return null;

  return parsed.map((item) => coerceExpenseItem(item));
}

function parseExpensesObjectInput(value) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = tryParseJson(value);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;

  const expenseItems = parseExpenseItemsInput(
    parsed.expenseItem ?? parsed.expenseItems ?? parsed.expenceItem ?? parsed.extraExpenses ?? parsed.expenses
  );

  return {
    ...(expenseItems !== null ? { expenseItem: expenseItems } : {}),
    ...(parsed.notes !== undefined || parsed.note !== undefined
      ? { notes: String(parsed.notes ?? parsed.note ?? '').trim() }
      : {}),
    ...(parsed.totalAmount !== undefined || parsed.total_amount !== undefined
      ? { totalAmount: Number.parseFloat(parsed.totalAmount ?? parsed.total_amount) || 0 }
      : {}),
    ...(parsed.adminExpenseApprovalStatus !== undefined
      ? { adminExpenseApprovalStatus: String(parsed.adminExpenseApprovalStatus).trim().toLowerCase() }
      : {}),
    ...(parsed.adminApprovalAmount !== undefined || parsed.admin_approval_amount !== undefined
      ? {
          adminApprovalAmount:
            Number.parseFloat(parsed.adminApprovalAmount ?? parsed.admin_approval_amount) || 0,
        }
      : {}),
    ...(parsed.receipt !== undefined || parsed.uploadReceipts !== undefined || parsed.Reciept !== undefined
      ? { receipt: coerceUploadReceipts(parsed.receipt ?? parsed.uploadReceipts ?? parsed.Reciept) }
      : {}),
  };
}

function getSurveyExpenses(survey) {
  const plain = survey?.toObject ? survey.toObject() : survey || {};

  if (plain.expenses && typeof plain.expenses === 'object') {
    const expenses = plain.expenses?.toObject ? plain.expenses.toObject() : plain.expenses;
    return {
      ...emptyExpenses(),
      notes: expenses.notes || '',
      totalAmount: Number(expenses.totalAmount) || 0,
      adminExpenseApprovalStatus: expenses.adminExpenseApprovalStatus || 'pending',
      adminApprovalAmount: Number(expenses.adminApprovalAmount) || 0,
      expenseItem: (expenses.expenseItem || []).map(coerceExpenseItem),
      receipt: coerceUploadReceipts(expenses.receipt),
    };
  }

  return {
    expenseItem: (plain.extraExpenses || []).map(coerceExpenseItem),
    notes: '',
    totalAmount: Number(plain.extraExpensesTotalAmount) || 0,
    adminExpenseApprovalStatus:
      plain.adminExpenseApprovalStatus || plain.adminApprovalStatus || 'pending',
    adminApprovalAmount: sumApprovedExtraExpenses(plain.extraExpenses || []),
    receipt: coerceUploadReceipts(plain.uploadReceipts),
  };
}

function setSurveyExpenses(survey, expenses) {
  survey.expenses = {
    ...emptyExpenses(),
    ...expenses,
    expenseItem: (expenses.expenseItem || []).map(coerceExpenseItem),
    receipt: coerceUploadReceipts(expenses.receipt),
  };
  survey.markModified('expenses');
}

function mergeSurveyExpenses(current, patch) {
  const merged = {
    ...emptyExpenses(),
    ...current,
    ...patch,
    expenseItem:
      patch.expenseItem !== undefined ? patch.expenseItem.map(coerceExpenseItem) : current.expenseItem,
    receipt: patch.receipt !== undefined ? coerceUploadReceipts(patch.receipt) : current.receipt,
  };

  if (patch.expenseItem !== undefined && patch.totalAmount === undefined) {
    merged.totalAmount = sumExtraExpenses(merged.expenseItem);
  }

  return merged;
}

function parseExtraExpensesApprovalInput(value) {
  return parseExpenseItemsInput(value);
}

function sumExtraExpenses(expenseItems) {
  return (expenseItems || []).reduce((total, item) => total + (Number(item?.price) || 0), 0);
}

function sumApprovedExtraExpenses(expenseItems) {
  return (expenseItems || []).reduce(
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

function formatReceiptsForResponse(receipts, baseUrl = API_BASE_URL) {
  return coerceUploadReceipts(receipts).map((filename) => toReceiptUrl(filename, baseUrl));
}

function formatExpensesForResponse(survey) {
  const surveyPlain = survey?.toObject ? survey.toObject() : survey;
  const expenses = getSurveyExpenses(surveyPlain);

  return {
    survey_id: surveyPlain._id,
    expenses: {
      expenseItem: expenses.expenseItem.map((item) => ({
        itemName: item.itemName || '',
        price: Number(item.price) || 0,
        approvedAmount: Number(item.approvedAmount) || 0,
      })),
      notes: expenses.notes || '',
      totalAmount: Number(expenses.totalAmount) || 0,
      adminExpenseApprovalStatus: expenses.adminExpenseApprovalStatus || 'pending',
      adminApprovalAmount: Number(expenses.adminApprovalAmount) || 0,
      receipt: formatReceiptsForResponse(expenses.receipt),
    },
  };
}

function sumExtraExpensePayments(survey) {
  const surveyPlain = survey?.toObject ? survey.toObject() : survey;
  const payments = surveyPlain.extraExpensePayments || [];
  return payments.reduce((total, item) => total + (Number(item?.amount) || 0), 0);
}

function getExtraExpensePayableTotals(survey) {
  const expenses = getSurveyExpenses(survey);
  const approvedTotal = roundMoney(
    Number(expenses.adminApprovalAmount) || sumApprovedExtraExpenses(expenses.expenseItem)
  );
  const paid = roundMoney(sumExtraExpensePayments(survey));
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

  const expenses = getSurveyExpenses(survey);
  if (String(expenses.adminExpenseApprovalStatus || '').toLowerCase() !== 'approved') {
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

function coerceSurveyExpensesForSave(surveyDoc) {
  const current = getSurveyExpenses(surveyDoc);
  return {
    ...emptyExpenses(),
    ...current,
    expenseItem: (current.expenseItem || []).map(coerceExpenseItem),
    receipt: coerceUploadReceipts(current.receipt),
  };
}

module.exports = {
  emptyExpenses,
  parseExpenseItemsInput,
  parseExpensesObjectInput,
  parseExtraExpensesInput: parseExpenseItemsInput,
  parseExtraExpensesApprovalInput,
  getSurveyExpenses,
  setSurveyExpenses,
  mergeSurveyExpenses,
  sumExtraExpenses,
  sumApprovedExtraExpenses,
  sumExtraExpensePayments,
  getExtraExpensePayableTotals,
  addExtraExpensePayment,
  VALID_EXTRA_EXPENSE_PAYMENT_METHODS,
  coerceUploadReceipts,
  coerceSurveyExpensesForSave,
  toReceiptUrl,
  formatReceiptsForResponse,
  formatExpensesForResponse,
  formatExtraExpensesForResponse: formatExpensesForResponse,
};
