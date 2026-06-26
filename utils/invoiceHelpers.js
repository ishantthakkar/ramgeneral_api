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

const VALID_INVOICE_PAYMENT_METHODS = [
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
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function sumInvoicePayments(survey) {
  const surveyPlain = survey?.toObject ? survey.toObject() : survey;
  const payments = surveyPlain?.invoicePayments || [];
  return payments.reduce((total, item) => total + (Number(item?.amount) || 0), 0);
}

function getInvoicePaymentTotals(survey, invoiceAmount) {
  const amount = roundMoney(Number(invoiceAmount) || 0);
  const paid = roundMoney(sumInvoicePayments(survey));
  const pending = roundMoney(Math.max(0, amount - paid));

  return {
    invoiceAmount: amount,
    paid,
    pending,
  };
}

function mapInvoicePayments(survey) {
  const surveyPlain = survey?.toObject ? survey.toObject() : survey;
  return (surveyPlain?.invoicePayments || []).map((payment) => {
    const plain = payment?.toObject ? payment.toObject() : payment;
    return {
      _id: plain._id,
      amount: roundMoney(Number(plain.amount) || 0),
      paymentMethod: plain.paymentMethod || '',
      note: plain.note || '',
      paymentDate: plain.paymentDate || null,
      createdAt: plain.createdAt || null,
    };
  });
}

async function addInvoicePayment(survey, { amount, paymentMethod, paymentDate, note }, invoiceAmount) {
  if (!survey) {
    const error = new Error('Survey not found.');
    error.statusCode = 404;
    throw error;
  }

  const invoiceFilename = getGenerateInvoiceForSurvey(survey);
  if (!invoiceFilename) {
    const error = new Error('Generate an invoice before recording payments.');
    error.statusCode = 400;
    throw error;
  }

  if (String(survey.invoiceStatus || '').toLowerCase() === 'fully_paid') {
    const error = new Error('Invoice is already fully paid.');
    error.statusCode = 400;
    throw error;
  }

  const totals = getInvoicePaymentTotals(survey, invoiceAmount);
  if (totals.invoiceAmount <= 0) {
    const error = new Error('Invoice amount is not available for this survey.');
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
  if (!VALID_INVOICE_PAYMENT_METHODS.includes(method)) {
    const error = new Error('A valid payment method is required.');
    error.statusCode = 400;
    throw error;
  }

  if (paymentAmount > totals.pending) {
    const error = new Error(
      `Payment cannot exceed pending invoice balance of ${totals.pending}.`
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

  if (!Array.isArray(survey.invoicePayments)) {
    survey.invoicePayments = [];
  }

  const nextPayment = {
    amount: paymentAmount,
    paymentMethod: method,
    note: String(note || '').trim(),
    paymentDate: parsedDate,
    createdAt: new Date(),
  };

  survey.invoicePayments.push(nextPayment);

  const paid = roundMoney(totals.paid + paymentAmount);
  const pending = roundMoney(Math.max(0, totals.invoiceAmount - paid));

  if (paid >= totals.invoiceAmount) {
    survey.invoiceStatus = 'fully_paid';
    survey.invoicePaidAt = new Date();
  }

  await survey.save();

  const savedPayment = survey.invoicePayments[survey.invoicePayments.length - 1];

  return {
    payment: savedPayment?.toObject ? savedPayment.toObject() : savedPayment,
    invoiceAmount: totals.invoiceAmount,
    paid,
    pending,
    invoiceStatus: survey.invoiceStatus,
    invoicePaidAt: survey.invoicePaidAt || null,
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
  VALID_INVOICE_PAYMENT_METHODS,
  roundMoney,
  sumInvoicePayments,
  getInvoicePaymentTotals,
  mapInvoicePayments,
  addInvoicePayment,
};
