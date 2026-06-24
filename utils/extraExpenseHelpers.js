const API_BASE_URL = process.env.API_BASE_URL || 'https://ramgeneral-api.onrender.com';

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
  }));
}

function sumExtraExpenses(extraExpenses) {
  return (extraExpenses || []).reduce((total, item) => total + (Number(item?.price) || 0), 0);
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
  }));
  const uploadReceipts = formatUploadReceiptsForResponse(surveyPlain.uploadReceipts);

  return {
    survey_id: surveyPlain._id,
    extraExpenses,
    totalAmount: Number(surveyPlain.extraExpensesTotalAmount) || 0,
    uploadReceipts,
    uploadReceipt: uploadReceipts[0] || '',
    adminApprovalStatus: surveyPlain.adminApprovalStatus || 'pending',
  };
}

module.exports = {
  parseExtraExpensesInput,
  sumExtraExpenses,
  coerceUploadReceipts,
  toReceiptUrl,
  formatUploadReceiptsForResponse,
  formatExtraExpensesForResponse,
};
