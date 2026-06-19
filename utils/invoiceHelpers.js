const mongoose = require('mongoose');
const {
  loadUsersMap,
  mapUserFromId,
  formatQuotationListWithUserMap,
  getSurveyIdString,
} = require('./quotationHelpers');

const invoiceFileFields = {
  customer_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer' },
  invoiceNumber: { type: String, trim: true, default: '' },
  url: { type: String, trim: true, default: '' },
  filename: { type: String, trim: true, default: '' },
  pdfName: { type: String, trim: true, default: '' },
  mimeType: { type: String, trim: true, default: '' },
  surveyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Survey' },
  subtotal: { type: Number, default: 0 },
  taxAmount: { type: Number, default: 0 },
  grandTotal: { type: Number, default: 0 },
  uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  uploadedByName: { type: String, trim: true, default: '' },
  createdAt: { type: Date, default: Date.now },
};

function randomFiveDigitInvoiceNumber() {
  return String(Math.floor(10000 + Math.random() * 90000));
}

async function generateUniqueInvoiceNumber() {
  const Survey = require('../models/Survey');

  for (let attempt = 0; attempt < 10; attempt++) {
    const invoiceNumber = randomFiveDigitInvoiceNumber();

    const existsInSurvey = await Survey.exists({
      'generateInvoice.invoiceNumber': invoiceNumber,
    });

    if (!existsInSurvey) {
      return invoiceNumber;
    }
  }

  throw new Error('Could not generate a unique invoice number.');
}

function buildGenerateInvoiceRecord({
  customer_id,
  invoiceNumber,
  url,
  filename,
  pdfName,
  mimeType,
  surveyId,
  subtotal,
  taxAmount,
  grandTotal,
  uploadedBy,
  uploadedByName,
}) {
  return {
    customer_id: customer_id || null,
    invoiceNumber: invoiceNumber || '',
    url,
    filename,
    pdfName: pdfName || filename || '',
    mimeType: mimeType || 'application/pdf',
    surveyId: surveyId || null,
    subtotal: subtotal ?? 0,
    taxAmount: taxAmount ?? 0,
    grandTotal: grandTotal ?? 0,
    uploadedBy: uploadedBy || null,
    uploadedByName: uploadedByName || '',
    createdAt: new Date(),
  };
}

function getGenerateInvoicesForSurvey(survey) {
  const surveyPlain = survey?.toObject ? survey.toObject() : survey;
  return surveyPlain?.generateInvoice || [];
}

function surveyInvoiceDataFilter() {
  return {
    generateInvoice: { $exists: true, $not: { $size: 0 } },
  };
}

function applySurveyInvoiceStatusFilter(surveyFilter, statusFilter) {
  if (statusFilter === 'all') return;

  if (statusFilter === 'pending') {
    surveyFilter.$or = [
      { invoiceStatus: 'pending' },
      { invoiceStatus: { $exists: false } },
      { invoiceStatus: null },
    ];
    return;
  }

  surveyFilter.invoiceStatus = statusFilter;
}

async function attachInvoiceFieldsToSurvey(surveyObj) {
  const surveyPlain = surveyObj?.toObject ? surveyObj.toObject() : surveyObj;
  const generateInvoice = getGenerateInvoicesForSurvey(surveyPlain);

  const userIds = new Set();
  for (const invoice of generateInvoice) {
    if (invoice.uploadedBy) userIds.add(invoice.uploadedBy.toString());
  }

  const userMap = await loadUsersMap(userIds);

  return {
    customer_id: surveyPlain.customer_id || null,
    invoiceStatus: surveyPlain.invoiceStatus || 'pending',
    generateInvoice: formatQuotationListWithUserMap(generateInvoice, userMap),
  };
}

module.exports = {
  invoiceFileFields,
  generateUniqueInvoiceNumber,
  buildGenerateInvoiceRecord,
  getGenerateInvoicesForSurvey,
  surveyInvoiceDataFilter,
  applySurveyInvoiceStatusFilter,
  attachInvoiceFieldsToSurvey,
  getSurveyIdString,
};
