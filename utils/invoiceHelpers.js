const API_BASE_URL = process.env.API_BASE_URL || 'https://ramgeneral-api.onrender.com';

function randomFiveDigitInvoiceNumber() {
  return String(Math.floor(10000 + Math.random() * 90000));
}

async function generateUniqueInvoiceNumber() {
  const Survey = require('../models/Survey');

  for (let attempt = 0; attempt < 10; attempt++) {
    const invoiceNumber = randomFiveDigitInvoiceNumber();

    const existsInSurvey = await Survey.exists({ invoiceNumber });

    if (!existsInSurvey) {
      return invoiceNumber;
    }
  }

  throw new Error('Could not generate a unique invoice number.');
}

function normalizeInvoiceFilename(value) {
  if (!value) return '';
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value) && value.length) {
    return normalizeInvoiceFilename(value[0]);
  }
  const plain = value?.toObject ? value.toObject() : value;
  if (typeof plain === 'object' && plain) {
    return (plain.pdfName || plain.filename || '').trim();
  }
  return '';
}

function coerceGenerateInvoice(value) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value.trim();
  return normalizeInvoiceFilename(value);
}

function toInvoicePdfUrl(value, baseUrl = API_BASE_URL) {
  const filename = normalizeInvoiceFilename(value);
  if (!filename) {
    const plain = typeof value === 'object' && value ? (value.toObject ? value.toObject() : value) : null;
    return (plain?.url || '').trim();
  }
  if (filename.startsWith('http://') || filename.startsWith('https://')) {
    return filename;
  }
  return `${baseUrl}/uploads/invoices/${filename}`;
}

function getGenerateInvoiceForSurvey(survey) {
  const surveyPlain = survey?.toObject ? survey.toObject() : survey;
  return normalizeInvoiceFilename(surveyPlain?.generateInvoice);
}

function surveyInvoiceDataFilter() {
  return {
    generateInvoice: { $exists: true, $nin: [null, ''] },
  };
}

function surveyInvoiceEligibilityFilter() {
  return {
    inspectionStatus: 'verified',
    quotationStatus: 'approved',
  };
}

function applySurveyInvoiceStatusFilter(surveyFilter, statusFilter) {
  if (statusFilter === 'all') return;

  if (statusFilter === 'pending') {
    surveyFilter.$or = [
      { invoiceStatus: { $exists: false } },
      { invoiceStatus: null },
    ];
    return;
  }

  surveyFilter.invoiceStatus = statusFilter;
}

function attachInvoiceFieldsToSurvey(surveyObj) {
  const surveyPlain = surveyObj?.toObject ? surveyObj.toObject() : surveyObj;
  const invoiceFilename = getGenerateInvoiceForSurvey(surveyPlain);

  return {
    customer_id: surveyPlain.customer_id || null,
    invoiceNumber: surveyPlain.invoiceNumber || '',
    invoiceStatus: surveyPlain.invoiceStatus || 'pending',
    generateInvoice: invoiceFilename ? toInvoicePdfUrl(invoiceFilename) : '',
  };
}

module.exports = {
  generateUniqueInvoiceNumber,
  getGenerateInvoiceForSurvey,
  surveyInvoiceDataFilter,
  surveyInvoiceEligibilityFilter,
  applySurveyInvoiceStatusFilter,
  attachInvoiceFieldsToSurvey,
  toInvoicePdfUrl,
  normalizeInvoiceFilename,
  coerceGenerateInvoice,
};
