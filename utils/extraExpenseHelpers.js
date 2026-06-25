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

function normalizeExpensesEntry(entry) {
  const plain = entry?.toObject ? entry.toObject() : entry;
  return {
    ...(plain?._id ? { _id: plain._id } : {}),
    ...emptyExpenses(),
    notes: String(plain?.notes || '').trim(),
    totalAmount: Number(plain?.totalAmount) || 0,
    adminExpenseApprovalStatus: (plain?.adminExpenseApprovalStatus || 'pending').toString().trim().toLowerCase(),
    adminApprovalAmount: Number(plain?.adminApprovalAmount) || 0,
    expenseItem: (plain?.expenseItem || []).map(coerceExpenseItem),
    receipt: coerceUploadReceipts(plain?.receipt),
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

function getSurveyExpensesList(survey) {
  const plain = survey?.toObject ? survey.toObject() : survey || {};

  if (Array.isArray(plain.expenses)) {
    return plain.expenses.map(normalizeExpensesEntry);
  }

  if (plain.expenses && typeof plain.expenses === 'object') {
    return [normalizeExpensesEntry(plain.expenses)];
  }

  const legacyItems = (plain.extraExpenses || []).map(coerceExpenseItem);
  const legacyTotal = Number(plain.extraExpensesTotalAmount) || 0;
  const legacyReceipt = coerceUploadReceipts(plain.uploadReceipts);
  const legacyStatus = plain.adminExpenseApprovalStatus || plain.adminApprovalStatus;
  const hasLegacy =
    legacyItems.length ||
    legacyTotal > 0 ||
    legacyReceipt.length ||
    (legacyStatus !== undefined && legacyStatus !== null && String(legacyStatus).trim());

  if (!hasLegacy) return [];

  return [
    normalizeExpensesEntry({
      expenseItem: legacyItems,
      totalAmount: legacyTotal,
      receipt: legacyReceipt,
      adminExpenseApprovalStatus: legacyStatus || 'pending',
      adminApprovalAmount: sumApprovedExtraExpenses(legacyItems),
    }),
  ];
}

function upsertSurveyExpensesEntry(survey, entry, expenseId) {
  if (!Array.isArray(survey.expenses)) {
    survey.expenses = [];
  }

  const normalized = normalizeExpensesEntry(entry);

  if (expenseId) {
    const idString = expenseId.toString();
    const existing = survey.expenses.id ? survey.expenses.id(expenseId) : null;
    if (existing) {
      existing.set(normalized);
      survey.markModified('expenses');
      return existing;
    }
    const idx = survey.expenses.findIndex((e) => (e?._id || '').toString() === idString);
    if (idx >= 0) {
      survey.expenses[idx] = { ...survey.expenses[idx], ...normalized };
      survey.markModified('expenses');
      return survey.expenses[idx];
    }
  }

  survey.expenses.push(normalized);
  survey.markModified('expenses');
  return survey.expenses[survey.expenses.length - 1];
}

function mergeSurveyExpensesEntry(current, patch) {
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
  const expenses = getSurveyExpensesList(surveyPlain);

  return {
    survey_id: surveyPlain._id,
    expenses: expenses.map((entry) => ({
      id: (entry._id || '').toString(),
      expenseItem: (entry.expenseItem || []).map((item) => ({
        itemName: item.itemName || '',
        price: Number(item.price) || 0,
        approvedAmount: Number(item.approvedAmount) || 0,
      })),
      notes: entry.notes || '',
      totalAmount: Number(entry.totalAmount) || 0,
      adminExpenseApprovalStatus: entry.adminExpenseApprovalStatus || 'pending',
      adminApprovalAmount: Number(entry.adminApprovalAmount) || 0,
      receipt: formatReceiptsForResponse(entry.receipt),
    })),
  };
}

function sumExtraExpensePayments(survey) {
  const surveyPlain = survey?.toObject ? survey.toObject() : survey;
  const payments = surveyPlain.extraExpensePayments || [];
  return payments.reduce((total, item) => total + (Number(item?.amount) || 0), 0);
}

function getExtraExpensePayableTotals(survey) {
  const entries = getSurveyExpensesList(survey);
  const approvedEntries = entries.filter(
    (e) => String(e.adminExpenseApprovalStatus || '').toLowerCase() === 'approved'
  );
  const approvedTotal = roundMoney(
    approvedEntries.reduce(
      (sum, e) =>
        sum +
        (Number(e.adminApprovalAmount) || sumApprovedExtraExpenses(e.expenseItem || [])),
      0
    )
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

  const totals = getExtraExpensePayableTotals(survey);
  if (totals.approvedTotal <= 0) {
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
  const list = getSurveyExpensesList(surveyDoc);
  if (!list.length) return [];
  return list.map(normalizeExpensesEntry);
}

module.exports = {
  emptyExpenses,
  parseExpenseItemsInput,
  parseExpensesObjectInput,
  parseExtraExpensesInput: parseExpenseItemsInput,
  parseExtraExpensesApprovalInput,
  getSurveyExpensesList,
  upsertSurveyExpensesEntry,
  mergeSurveyExpensesEntry,
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
