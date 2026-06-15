const mongoose = require('mongoose');
const User = require('../models/User');

const quotationFileFields = {
  customer_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer' },
  quotationNumber: { type: String, trim: true, default: '' },
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

function randomFiveDigitQuotationNumber() {
  return String(Math.floor(10000 + Math.random() * 90000));
}

async function generateUniqueQuotationNumber() {
  const Survey = require('../models/Survey');
  const Customer = require('../models/Customer');

  for (let attempt = 0; attempt < 10; attempt++) {
    const quotationNumber = randomFiveDigitQuotationNumber();

    const existsInSurvey = await Survey.exists({
      'generateQuotation.quotationNumber': quotationNumber,
    });
    const existsInCustomer = await Customer.exists({
      $or: [
        { 'generateQuotation.quotationNumber': quotationNumber },
        { 'quotations.quotationNumber': quotationNumber },
      ],
    });

    if (!existsInSurvey && !existsInCustomer) {
      return quotationNumber;
    }
  }

  throw new Error('Could not generate a unique quotation number.');
}

function buildGenerateQuotationRecord({
  customer_id,
  quotationNumber,
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
    quotationNumber: quotationNumber || '',
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

function buildUploadSignedQuotationRecord({
  customer_id,
  surveyId,
  url,
  filename,
  pdfName,
  mimeType,
  uploadedBy,
  uploadedByName,
}) {
  return {
    customer_id: customer_id || null,
    surveyId: surveyId || null,
    url,
    filename,
    pdfName: pdfName || filename || '',
    mimeType: mimeType || '',
    uploadedBy: uploadedBy || null,
    uploadedByName: uploadedByName || '',
    createdAt: new Date(),
  };
}

function isLegacyGeneratedQuotation(q) {
  if (q.source === 'generated') return true;
  const name = (q.filename || q.pdfName || '').toString();
  return name.startsWith('quotation-');
}

function dedupeQuotationItems(items) {
  const seen = new Set();
  return (items || []).filter((q) => {
    const key = q._id?.toString?.() || q.url || '';
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function getSurveyIdString(survey) {
  const plain = survey?.toObject ? survey.toObject() : survey;
  return plain?._id?.toString?.() || String(plain?._id || '');
}

function matchesSurveyId(item, surveyId) {
  if (!surveyId) return false;
  const itemSurveyId = item?.surveyId?.toString?.() || String(item?.surveyId || '');
  return itemSurveyId === surveyId;
}

function getLegacyCustomerGenerateQuotations(customer, surveyId) {
  const plain = customer?.toObject ? customer.toObject() : customer;
  const fromNew = (plain?.generateQuotation || []).filter((q) => matchesSurveyId(q, surveyId));
  const fromLegacy = (plain?.quotations || []).filter(
    (q) => isLegacyGeneratedQuotation(q) && matchesSurveyId(q, surveyId)
  );
  return dedupeQuotationItems([...fromLegacy, ...fromNew]);
}

function getLegacyCustomerUploadQuotations(customer, surveyId) {
  const plain = customer?.toObject ? customer.toObject() : customer;
  const fromNew = (plain?.uploadSignedQuotation || []).filter((q) =>
    matchesSurveyId(q, surveyId)
  );
  const fromLegacy = (plain?.quotations || []).filter(
    (q) => q.source === 'uploaded' && !isLegacyGeneratedQuotation(q) && matchesSurveyId(q, surveyId)
  );
  return dedupeQuotationItems([...fromLegacy, ...fromNew]);
}

function getGenerateQuotationsForSurvey(survey, customer) {
  const surveyPlain = survey?.toObject ? survey.toObject() : survey;
  const surveyId = getSurveyIdString(surveyPlain);
  const fromSurvey = surveyPlain?.generateQuotation || [];
  if (fromSurvey.length) return fromSurvey;
  return getLegacyCustomerGenerateQuotations(customer, surveyId);
}

function getUploadSignedQuotationsForSurvey(survey, customer) {
  const surveyPlain = survey?.toObject ? survey.toObject() : survey;
  const surveyId = getSurveyIdString(surveyPlain);
  const fromSurvey = surveyPlain?.uploadSignedQuotation || [];
  if (fromSurvey.length) return fromSurvey;
  return getLegacyCustomerUploadQuotations(customer, surveyId);
}

function hasUploadSignedQuotationForSurvey(survey, customer) {
  return getUploadSignedQuotationsForSurvey(survey, customer).length > 0;
}

function stripLegacyQuotationsField(target) {
  if (target && typeof target === 'object') {
    delete target.quotations;
  }
}

function stripCustomerQuotationFields(customerObj) {
  if (!customerObj || typeof customerObj !== 'object') return;
  stripLegacyQuotationsField(customerObj);
  delete customerObj.generateQuotation;
  delete customerObj.uploadSignedQuotation;
  delete customerObj.quotationStatus;
  delete customerObj.quotationApprovedBy;
  delete customerObj.quotationApprovedAt;
  delete customerObj.quotationApprovedByUser;
}

async function loadUsersMap(userIds) {
  const ids = [...userIds].filter(Boolean);
  if (!ids.length) return new Map();

  const users = await User.find({ _id: { $in: ids } })
    .select('fullName email mobileNumber userRole')
    .lean();

  return new Map(users.map((u) => [u._id.toString(), u]));
}

function mapUserFromId(id, userMap) {
  if (!id) return null;
  const key = id.toString?.() || String(id);
  const user = userMap.get(key);
  if (!user) return { _id: key };
  return {
    _id: user._id,
    fullName: user.fullName,
    email: user.email,
    mobileNumber: user.mobileNumber,
    userRole: user.userRole,
  };
}

function formatQuotationListWithUserMap(quotations, userMap) {
  return (quotations || []).map((q) => {
    const plain = q?.toObject ? q.toObject() : { ...q };
    const uploader = mapUserFromId(plain.uploadedBy, userMap);
    return {
      ...plain,
      uploadedByName: plain.uploadedByName || uploader?.fullName || '',
      uploadedByUser: uploader,
    };
  });
}

async function formatQuotationListForResponse(quotations) {
  const list = quotations || [];
  const userIds = new Set();
  for (const q of list) {
    const plain = q?.toObject ? q.toObject() : q;
    if (plain.uploadedBy) userIds.add(plain.uploadedBy.toString());
  }
  const userMap = await loadUsersMap(userIds);
  return formatQuotationListWithUserMap(list, userMap);
}

async function attachQuotationFieldsToSurvey(surveyObj, customer) {
  const surveyPlain = surveyObj?.toObject ? surveyObj.toObject() : surveyObj;
  const generateQuotation = getGenerateQuotationsForSurvey(surveyPlain, customer);
  const uploadSignedQuotation = getUploadSignedQuotationsForSurvey(surveyPlain, customer);

  const userIds = new Set();
  if (surveyPlain.quotationApprovedBy) {
    userIds.add(surveyPlain.quotationApprovedBy.toString());
  }
  for (const q of [...generateQuotation, ...uploadSignedQuotation]) {
    if (q.uploadedBy) userIds.add(q.uploadedBy.toString());
  }

  const userMap = await loadUsersMap(userIds);
  stripLegacyQuotationsField(surveyPlain);

  return {
    customer_id: surveyPlain.customer_id || customer?._id || null,
    quotationStatus: surveyPlain.quotationStatus || 'pending',
    quotationApprovedAt: surveyPlain.quotationApprovedAt || surveyPlain.confirmDate || null,
    confirmDate: surveyPlain.confirmDate || surveyPlain.quotationApprovedAt || null,
    quotationApprovedBy: surveyPlain.quotationApprovedBy || null,
    quotationApprovedByUser: mapUserFromId(surveyPlain.quotationApprovedBy, userMap),
    generateQuotation: formatQuotationListWithUserMap(generateQuotation, userMap),
    uploadSignedQuotation: formatQuotationListWithUserMap(uploadSignedQuotation, userMap),
  };
}

async function attachSurveysWithQuotations(surveys, customer) {
  const { enrichSurveyNotesInObject } = require('./surveyNotes');

  return Promise.all(
    (surveys || []).map(async (survey) => {
      const surveyObj = survey?.toObject ? survey.toObject() : { ...survey };
      const quotationFields = await attachQuotationFieldsToSurvey(surveyObj, customer);
      return enrichSurveyNotesInObject({ ...surveyObj, ...quotationFields });
    })
  );
}

function uploadSignedQuotationSurveyFilter() {
  return {
    $or: [
      { uploadSignedQuotation: { $exists: true, $not: { $size: 0 } } },
    ],
  };
}

function surveyQuotationDataFilter() {
  return {
    $or: [
      { generateQuotation: { $exists: true, $not: { $size: 0 } } },
      { uploadSignedQuotation: { $exists: true, $not: { $size: 0 } } },
    ],
  };
}

function applySurveyQuotationStatusFilter(surveyFilter, statusFilter) {
  if (statusFilter === 'all') return;

  if (statusFilter === 'pending') {
    surveyFilter.$or = [
      { quotationStatus: 'pending' },
      { quotationStatus: { $exists: false } },
      { quotationStatus: null },
    ];
    return;
  }

  surveyFilter.quotationStatus = statusFilter;
}

function formatJobId(sequence) {
  return `JB${sequence}`;
}

async function getNextJobId() {
  const Survey = require('../models/Survey');
  const surveys = await Survey.find({ job_id: /^JB\d+$/i }).select('job_id').lean();

  let maxNumber = 0;
  for (const { job_id } of surveys) {
    const match = String(job_id || '').match(/^JB(\d+)$/i);
    if (!match) continue;
    const parsed = parseInt(match[1], 10);
    if (!Number.isNaN(parsed) && parsed > maxNumber) {
      maxNumber = parsed;
    }
  }

  return formatJobId(maxNumber + 1);
}

module.exports = {
  quotationFileFields,
  generateUniqueQuotationNumber,
  buildGenerateQuotationRecord,
  buildUploadSignedQuotationRecord,
  getGenerateQuotationsForSurvey,
  getUploadSignedQuotationsForSurvey,
  hasUploadSignedQuotationForSurvey,
  formatQuotationListForResponse,
  formatQuotationListWithUserMap,
  loadUsersMap,
  mapUserFromId,
  attachQuotationFieldsToSurvey,
  attachSurveysWithQuotations,
  stripCustomerQuotationFields,
  stripLegacyQuotationsField,
  uploadSignedQuotationSurveyFilter,
  surveyQuotationDataFilter,
  applySurveyQuotationStatusFilter,
  getSurveyIdString,
  formatJobId,
  getNextJobId,
};
