const mongoose = require('mongoose');
const User = require('../models/User');

const quotationFileFields = {
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

function buildGenerateQuotationRecord({
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
  url,
  filename,
  pdfName,
  mimeType,
  uploadedBy,
  uploadedByName,
}) {
  return {
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

function getGenerateQuotations(customer) {
  const plain = customer?.toObject ? customer.toObject() : customer;
  const fromNew = plain?.generateQuotation || [];
  const fromLegacy = (plain?.quotations || []).filter(isLegacyGeneratedQuotation);
  return dedupeQuotationItems([...fromLegacy, ...fromNew]);
}

function getUploadSignedQuotations(customer) {
  const plain = customer?.toObject ? customer.toObject() : customer;
  const fromNew = plain?.uploadSignedQuotation || [];
  const fromLegacy = (plain?.quotations || []).filter(
    (q) => q.source === 'uploaded' && !isLegacyGeneratedQuotation(q)
  );
  return dedupeQuotationItems([...fromLegacy, ...fromNew]);
}

function stripLegacyQuotationsField(customerObj) {
  if (customerObj && typeof customerObj === 'object') {
    delete customerObj.quotations;
  }
}

function hasUploadSignedQuotation(customer) {
  return getUploadSignedQuotations(customer).length > 0;
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

async function attachQuotationFieldsToCustomer(customerObj) {
  const generateQuotation = getGenerateQuotations(customerObj);
  const uploadSignedQuotation = getUploadSignedQuotations(customerObj);

  const userIds = new Set();
  if (customerObj.quotationApprovedBy) {
    userIds.add(customerObj.quotationApprovedBy.toString());
  }
  for (const q of [...generateQuotation, ...uploadSignedQuotation]) {
    if (q.uploadedBy) userIds.add(q.uploadedBy.toString());
  }

  const userMap = await loadUsersMap(userIds);

  stripLegacyQuotationsField(customerObj);

  return {
    quotationStatus: customerObj.quotationStatus || 'pending',
    quotationApprovedAt: customerObj.quotationApprovedAt || null,
    quotationApprovedBy: customerObj.quotationApprovedBy || null,
    quotationApprovedByUser: mapUserFromId(customerObj.quotationApprovedBy, userMap),
    generateQuotation: formatQuotationListWithUserMap(generateQuotation, userMap),
    uploadSignedQuotation: formatQuotationListWithUserMap(uploadSignedQuotation, userMap),
  };
}

function uploadSignedQuotationFilter() {
  return {
    $or: [
      { uploadSignedQuotation: { $exists: true, $not: { $size: 0 } } },
      { quotations: { $elemMatch: { source: 'uploaded' } } },
    ],
  };
}

module.exports = {
  quotationFileFields,
  buildGenerateQuotationRecord,
  buildUploadSignedQuotationRecord,
  getGenerateQuotations,
  getUploadSignedQuotations,
  hasUploadSignedQuotation,
  formatQuotationListForResponse,
  formatQuotationListWithUserMap,
  loadUsersMap,
  mapUserFromId,
  attachQuotationFieldsToCustomer,
  stripLegacyQuotationsField,
  uploadSignedQuotationFilter,
};
