const mongoose = require('mongoose');
const Customer = require('../models/Customer');
const CustomerActivity = require('../models/CustomerActivity');
const Admin = require('../models/Admin');
const Survey = require('../models/Survey');
const User = require('../models/User');
const { createLog } = require('../utils/logger');
const { isSalesManagerRole } = require('../constants/userRoles');
const { enrichAreasWithProducts } = require('../utils/surveyProductUtils');
const {
  getQuotationAddresses,
  generatePdfBuffer,
  saveQuotationPdf,
} = require('../utils/quotationPdf');

const API_BASE_URL = process.env.API_BASE_URL || 'https://ramgeneral-api.onrender.com';

function getCustomerDisplayName(customer) {
  const lead = customer?.leadId && typeof customer.leadId === 'object' ? customer.leadId : null;
  return customer?.name || lead?.leadName || lead?.name || 'Customer';
}

function getCompanyInfo() {
  return {
    name: process.env.COMPANY_NAME || 'RAM GENERAL SUPPLY',
    address: process.env.COMPANY_ADDRESS || '245 East 17th Street Paterson, NJ 07524',
    phone: process.env.COMPANY_PHONE || '(123) 456 7890',
    email: process.env.COMPANY_EMAIL || 'ramgeneral@123.gmail.com',
  };
}

function buildQuotationRecord({
  url,
  filename,
  pdfName,
  mimeType,
  source,
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
    mimeType: mimeType || '',
    source: source || 'uploaded',
    uploadedBy: uploadedBy || null,
    uploadedByName: uploadedByName || '',
    surveyId: surveyId || null,
    subtotal: subtotal ?? 0,
    taxAmount: taxAmount ?? 0,
    grandTotal: grandTotal ?? 0,
    createdAt: new Date(),
  };
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

function formatQuotationsWithUserMap(quotations, userMap) {
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

async function formatQuotationsForResponse(quotations) {
  const list = quotations || [];
  const userIds = new Set();

  for (const q of list) {
    const plain = q?.toObject ? q.toObject() : q;
    if (plain.uploadedBy) userIds.add(plain.uploadedBy.toString());
  }

  const userMap = await loadUsersMap(userIds);
  return formatQuotationsWithUserMap(list, userMap);
}

function collectQuotationRelatedUserIds(customers) {
  const userIds = new Set();
  for (const customer of customers) {
    if (customer.user_id) {
      const salesId = customer.user_id._id || customer.user_id;
      userIds.add(salesId.toString());
    }
    if (customer.quotationApprovedBy) {
      userIds.add(customer.quotationApprovedBy.toString());
    }
    for (const q of customer.quotations || []) {
      if (q.uploadedBy) userIds.add(q.uploadedBy.toString());
    }
  }
  return userIds;
}

async function buildAdminCustomerQuotationsList(customers) {
  const userMap = await loadUsersMap(collectQuotationRelatedUserIds(customers));

  return customers.map((customer) => ({
    customerId: customer._id,
    customerName: getCustomerDisplayName(customer),
    accountNumber: customer.accountNumber || '',
    company: customer.company || '',
    quotationStatus: customer.quotationStatus || 'pending',
    quotationApprovedAt: customer.quotationApprovedAt || null,
    quotationApprovedBy: customer.quotationApprovedBy || null,
    quotationApprovedByUser: mapUserFromId(customer.quotationApprovedBy, userMap),
    salesPerson: mapUploadedByUserForApproval(mapUserFromId(customer.user_id, userMap)),
    quotations: formatQuotationsWithUserMap(customer.quotations || [], userMap),
  }));
}

function mapUploadedByUserForApproval(user) {
  if (!user) return null;
  return {
    _id: user._id,
    fullName: user.fullName || '',
    email: user.email || '',
    mobileNumber: user.mobileNumber || '',
    userRole: user.userRole || '',
  };
}

function mapCustomerQuotationApprovalItem(customer, userMap) {
  const uploaded = (customer.quotations || []).filter((q) => q.source === 'uploaded');
  const quotations = uploaded.map((q) => {
    const plain = q?.toObject ? q.toObject() : { ...q };
    return {
      url: plain.url || '',
      uploadedByUser: mapUploadedByUserForApproval(
        mapUserFromId(plain.uploadedBy, userMap)
      ),
    };
  });

  return {
    customerId: customer._id,
    customerName: getCustomerDisplayName(customer),
    quotationStatus: customer.quotationStatus || 'pending',
    quotations,
  };
}

async function buildManagerApprovalQuotationsList(customers) {
  const userIds = new Set();
  for (const customer of customers) {
    for (const q of customer.quotations || []) {
      if (q.source === 'uploaded' && q.uploadedBy) {
        userIds.add(q.uploadedBy.toString());
      }
    }
  }

  const userMap = await loadUsersMap(userIds);

  return customers.map((customer) => mapCustomerQuotationApprovalItem(customer, userMap));
}

function applyQuotationStatusFilter(customerFilter, statusFilter) {
  if (statusFilter === 'all') return;

  if (statusFilter === 'pending') {
    customerFilter.$or = [
      { quotationStatus: 'pending' },
      { quotationStatus: { $exists: false } },
      { quotationStatus: null },
    ];
    return;
  }

  customerFilter.quotationStatus = statusFilter;
}

async function getTeamSalesPersonIds(managerId) {
  const teamMembers = await User.find({ reportsTo: managerId }).select('_id').lean();
  return teamMembers.map((sp) => sp._id);
}

async function assertSalesManagerCanAccessCustomer(managerId, customer) {
  if (!customer?.user_id) {
    return { ok: false, message: 'Customer has no assigned sales person.' };
  }

  const salesPersonId = customer.user_id._id || customer.user_id;
  const salesPerson = await User.findById(salesPersonId).select('reportsTo userRole').lean();

  if (!salesPerson) {
    return { ok: false, message: 'Assigned sales person not found.' };
  }

  const reportsToId = salesPerson.reportsTo?.toString?.() || String(salesPerson.reportsTo || '');
  if (reportsToId !== managerId.toString()) {
    return { ok: false, message: 'This customer is not assigned to your sales team.' };
  }

  return { ok: true, salesPerson };
}

async function formatCustomerQuotationMeta(customer) {
  const plain = customer?.toObject ? customer.toObject() : customer;
  const userIds = new Set();

  if (plain.quotationApprovedBy) userIds.add(plain.quotationApprovedBy.toString());

  const userMap = await loadUsersMap(userIds);

  return {
    quotationStatus: plain.quotationStatus || 'pending',
    quotationApprovedBy: plain.quotationApprovedBy || null,
    quotationApprovedAt: plain.quotationApprovedAt || null,
    quotationApprovedByUser: mapUserFromId(plain.quotationApprovedBy, userMap),
  };
}

async function recordQuotationCustomerActivity(customerId, userId, activityType, notes) {
  await CustomerActivity.create({
    customer_id: customerId,
    user_id: userId,
    activityType,
    date: new Date(),
    notes: notes || '',
    outcome: activityType,
  });
}

function resolveAreaLabel(survey, area, index) {
  const surveyAreaName = (survey.areaName || '').trim();
  if (surveyAreaName) return surveyAreaName;

  const itemAreaName = (area.areaName || '').trim();
  if (itemAreaName) return itemAreaName;

  return area.existingFixtureType || area.note || `Area ${index + 1}`;
}

async function buildLineItemsFromSurvey(survey) {
  const areas = await enrichAreasWithProducts(survey.areas || []);

  return areas
    .map((area, index) => {
      const quantity = parseFloat(area.proposedQty) || 0;
      const unitPrice =
        parseFloat(area.price) ||
        area.product?.salesPrice ||
        area.product?.price ||
        0;
      const total = quantity * unitPrice;
      const proposedFixture =
        area.product?.name || area.existingFixtureType || area.existingBulbs || 'Fixture';

      return {
        area: resolveAreaLabel(survey, area, index),
        proposedFixture,
        quantity,
        unitPrice,
        total,
      };
    })
    .filter((row) => row.quantity > 0 || row.unitPrice > 0);
}

async function buildLineItemsFromSurveys(surveys) {
  const lineItems = [];
  for (const survey of surveys) {
    const items = await buildLineItemsFromSurvey(survey);
    lineItems.push(...items);
  }
  return lineItems;
}

async function resolveSurveysForQuotation(customerId, surveyId) {
  if (surveyId) {
    if (!mongoose.Types.ObjectId.isValid(surveyId)) {
      return { error: 'Invalid surveyId.' };
    }
    const survey = await Survey.findOne({ _id: surveyId, customer_id: customerId });
    if (!survey) {
      return { error: 'Survey not found for this customer.' };
    }
    if (!survey.areas?.length) {
      return { error: 'Survey has no area line items.' };
    }
    return { surveys: [survey] };
  }

  const surveys = await Survey.find({ customer_id: customerId }).sort({ createdAt: 1 });
  const withAreas = surveys.filter((s) => Array.isArray(s.areas) && s.areas.length > 0);

  if (!withAreas.length) {
    return { error: 'No survey with area items found for this customer.' };
  }

  return { surveys: withAreas };
}

exports.createQuotation = async (req, res) => {
  try {
    const customerId = req.params.customerId || req.params.id || req.body.customerId;
    const { surveyId } = req.body || {};

    if (!customerId || !mongoose.Types.ObjectId.isValid(customerId)) {
      return res.status(400).json({ message: 'Valid customerId is required.' });
    }

    const customer = await Customer.findById(customerId)
      .populate('user_id', 'fullName mobileNumber email')
      .populate('leadId', 'leadName name')
      .lean();

    if (!customer) {
      return res.status(404).json({ message: 'Customer not found.' });
    }

    const surveyResult = await resolveSurveysForQuotation(customerId, surveyId);
    if (surveyResult.error) {
      return res.status(404).json({ message: surveyResult.error });
    }

    const { surveys } = surveyResult;
    const lineItems = await buildLineItemsFromSurveys(surveys);

    if (!lineItems.length) {
      return res.status(400).json({
        message: 'Survey has no line items. Add products with quantity and price in survey areas.',
      });
    }

    const grandTotal = lineItems.reduce((sum, row) => sum + row.total, 0);

    const primaryContact = (customer.contactInfo || [])[0] || {};
    const salesPerson = customer.user_id || {};

    const { serviceAddress, billingAddress } = getQuotationAddresses(customer);

    const pdfData = {
      company: getCompanyInfo(),
      generatedDate: new Date(),
      serviceAddress,
      billingAddress,
      salesPerson: {
        name: salesPerson.fullName || '',
        phone: salesPerson.mobileNumber || customer.mobileNumber || '',
      },
      customerContact: {
        name: primaryContact.name || getCustomerDisplayName(customer),
        phone: primaryContact.phone || primaryContact.mobile || customer.mobileNumber || '',
        email: primaryContact.email || customer.email || '',
      },
      lineItems,
      grandTotal,
    };

    const pdfBuffer = await generatePdfBuffer(pdfData);
    const { filename, relativePath } = await saveQuotationPdf(pdfBuffer, customerId);
    const pdfUrl = `${API_BASE_URL}/${relativePath}`;

    const generator = req.user?.id
      ? await User.findById(req.user.id).select('fullName email').lean()
      : null;

    const quotationRecord = buildQuotationRecord({
      url: pdfUrl,
      filename,
      surveyId: surveys[0]._id,
      uploadedBy: req.user?.id,
      uploadedByName: generator?.fullName || '',
    });

    const updatedCustomer = await Customer.findByIdAndUpdate(
      customerId,
      { $push: { quotations: quotationRecord } },
      { new: true }
    );

    if (req.user?.id) {
      await createLog(
        'Quotation Generated',
        req.user.id,
        getCustomerDisplayName(customer),
        'Customer',
        customer._id
      );
    }

    const savedQuotation = updatedCustomer.quotations[updatedCustomer.quotations.length - 1];
    const formatted = (await formatQuotationsForResponse([savedQuotation]))[0];

    return res.status(201).json({
      message: 'Quotation generated successfully.',
      pdfUrl,
    });
  } catch (error) {
    console.error('Create quotation error:', error);
    return res.status(500).json({ message: 'Server error generating quotation PDF.' });
  }
};

exports.uploadQuotation = async (req, res) => {
  try {
    const customerId = req.params.customerId || req.params.id || req.body.customerId;

    if (!customerId || !mongoose.Types.ObjectId.isValid(customerId)) {
      return res.status(400).json({ message: 'Valid customerId is required.' });
    }

    const files = req.files || [];
    if (!files.length) {
      return res.status(400).json({
        message: 'At least one quotation file is required (PDF or image).',
      });
    }

    const customer = await Customer.findById(customerId);
    if (!customer) {
      return res.status(404).json({ message: 'Customer not found.' });
    }

    const uploader = req.user?.id
      ? await User.findById(req.user.id).select('fullName email mobileNumber').lean()
      : null;
    const uploadedByName = uploader?.fullName || req.user?.email || '';

    const quotationRecords = files.map((file) => {
      const relativePath = `uploads/quotations/${file.filename}`;
      const pdfName = file.originalname || file.filename;
      return buildQuotationRecord({
        url: `${API_BASE_URL}/${relativePath}`,
        filename: file.filename,
        pdfName,
        mimeType: file.mimetype,
        source: 'uploaded',
        uploadedBy: req.user?.id,
        uploadedByName,
      });
    });

    customer.quotations.push(...quotationRecords);
    customer.quotationStatus = 'pending';
    customer.quotationApprovedBy = null;
    customer.quotationApprovedAt = null;
    customer.markModified('quotations');
    await customer.save();

    const updatedCustomer = await Customer.findById(customerId);

    if (req.user?.id) {
      await recordQuotationCustomerActivity(
        customer._id,
        req.user.id,
        'Quotation Uploaded',
        `Uploaded ${quotationRecords.length} quotation file(s).`
      );
      await createLog(
        'Quotation Uploaded',
        req.user.id,
        getCustomerDisplayName(customer),
        'Customer',
        customer._id
      );
    }

    const savedQuotations = updatedCustomer.quotations
      .filter((q) => q.source === 'uploaded')
      .slice(-quotationRecords.length);
    const formattedQuotations = await formatQuotationsForResponse(savedQuotations);
    const quotationMeta = await formatCustomerQuotationMeta(updatedCustomer);

    return res.status(201).json({
      message: 'Quotation received successfully.',
      ...quotationMeta,
      pdfUrls: formattedQuotations.map((q) => q.url),
      quotations: formattedQuotations,
    });
  } catch (error) {
    console.error('Upload quotation error:', error);
    return res.status(500).json({ message: 'Server error uploading quotation files.' });
  }
};

exports.listQuotationsForManagerApproval = async (req, res) => {
  try {
    const managerId = req.user?.id;
    if (!managerId) {
      return res.status(401).json({ message: 'User not authenticated.' });
    }

    const manager = await User.findById(managerId)
      .select('fullName email mobileNumber userRole')
      .lean();

    if (!manager) {
      return res.status(401).json({ message: 'Invalid authenticated user.' });
    }

    if (!isSalesManagerRole(manager.userRole)) {
      return res.status(403).json({
        message: 'Only sales managers can view the quotation approval list.',
      });
    }

    const { quotationStatus, salesPersonId, salesPerson } = req.query;
    const filterSalesPersonId = salesPersonId || salesPerson;
    const statusFilter = quotationStatus
      ? quotationStatus.toString().trim().toLowerCase()
      : 'all';

    if (!['pending', 'approved', 'all'].includes(statusFilter)) {
      return res.status(400).json({
        message: 'Invalid quotationStatus. Allowed: pending, approved, all.',
      });
    }

    const teamIds = await getTeamSalesPersonIds(managerId);

    const customerFilter = {
      user_id: { $exists: true, $ne: null },
      quotations: { $elemMatch: { source: 'uploaded' } },
    };

    if (teamIds.length) {
      customerFilter.user_id = { $in: teamIds };
    } else {
      return res.status(200).json({
        quotations: [],
        total: 0,
        message:
          'No sales persons are assigned to you (reportsTo). Assign team members in user settings.',
      });
    }

    if (filterSalesPersonId) {
      if (!mongoose.Types.ObjectId.isValid(filterSalesPersonId)) {
        return res.status(400).json({ message: 'Invalid salesPersonId.' });
      }
      const isOnTeam = teamIds.some((id) => id.toString() === filterSalesPersonId.toString());
      if (!isOnTeam) {
        return res.status(403).json({ message: 'Sales person is not on your team.' });
      }
      customerFilter.user_id = filterSalesPersonId;
    }

    applyQuotationStatusFilter(customerFilter, statusFilter);

    const customers = await Customer.find(customerFilter)
      .select('name quotations quotationStatus quotationApprovedAt user_id leadId')
      .populate('user_id', 'fullName email mobileNumber')
      .populate('leadId', 'leadName name')
      .sort({ updatedAt: -1 })
      .lean();

    const quotations = await buildManagerApprovalQuotationsList(customers);

    return res.status(200).json({
      quotations,
      total: quotations.length,
    });
  } catch (error) {
    console.error('List quotations for manager approval error:', error);
    return res.status(500).json({ message: 'Server error fetching quotation approval list.' });
  }
};

exports.listCustomerQuotationsForAdmin = async (req, res) => {
  try {
    const admin = await Admin.findById(req.user?.id).select('email').lean();
    if (!admin) {
      return res.status(403).json({ message: 'Only admins can access customer quotations.' });
    }

    const { quotationStatus, salesPersonId, salesPerson, hasQuotations } = req.query;
    const filterSalesPersonId = salesPersonId || salesPerson;
    const statusFilter = quotationStatus
      ? quotationStatus.toString().trim().toLowerCase()
      : 'all';

    if (!['pending', 'approved', 'all'].includes(statusFilter)) {
      return res.status(400).json({
        message: 'Invalid quotationStatus. Allowed: pending, approved, all.',
      });
    }

    const customerFilter = {};

    if (hasQuotations === 'true') {
      customerFilter.quotations = { $exists: true, $not: { $size: 0 } };
    }

    if (filterSalesPersonId) {
      if (!mongoose.Types.ObjectId.isValid(filterSalesPersonId)) {
        return res.status(400).json({ message: 'Invalid salesPersonId.' });
      }
      customerFilter.user_id = filterSalesPersonId;
    }

    applyQuotationStatusFilter(customerFilter, statusFilter);

    const customers = await Customer.find(customerFilter)
      .select(
        'name company accountNumber quotations quotationStatus quotationApprovedBy quotationApprovedAt user_id leadId'
      )
      .populate('user_id', 'fullName email mobileNumber userRole')
      .populate('leadId', 'leadName name')
      .sort({ updatedAt: -1 })
      .lean();

    const customerQuotations = await buildAdminCustomerQuotationsList(customers);

    return res.status(200).json({
      customers: customerQuotations,
      total: customerQuotations.length,
    });
  } catch (error) {
    console.error('List customer quotations for admin error:', error);
    return res.status(500).json({ message: 'Server error fetching customer quotations.' });
  }
};

exports.listCustomerQuotations = async (req, res) => {
  try {
    const customerId = req.params.customerId || req.params.id;
    const { quotationStatus } = req.query;

    if (!customerId || !mongoose.Types.ObjectId.isValid(customerId)) {
      return res.status(400).json({ message: 'Valid customerId is required.' });
    }

    const customer = await Customer.findById(customerId).select(
      'name quotations quotationStatus quotationApprovedBy quotationApprovedAt'
    );
    if (!customer) {
      return res.status(404).json({ message: 'Customer not found.' });
    }

    const quotationMeta = await formatCustomerQuotationMeta(customer);

    if (quotationStatus) {
      const status = quotationStatus.toString().trim().toLowerCase();
      if (!['pending', 'approved'].includes(status)) {
        return res.status(400).json({
          message: 'Invalid quotationStatus. Allowed: pending, approved.',
        });
      }
      if (quotationMeta.quotationStatus !== status) {
        return res.status(200).json({
          customerId,
          ...quotationMeta,
          quotations: [],
          total: 0,
        });
      }
    }

    const quotations = (customer.quotations || []).filter((q) => q.source === 'uploaded');
    const formattedQuotations = await formatQuotationsForResponse(quotations);

    return res.status(200).json({
      customerId,
      ...quotationMeta,
      quotations: formattedQuotations,
      total: formattedQuotations.length,
    });
  } catch (error) {
    console.error('List customer quotations error:', error);
    return res.status(500).json({ message: 'Server error fetching quotations.' });
  }
};

exports.approveQuotation = async (req, res) => {
  try {
    const customerId = req.params.customerId || req.params.id;
    const approverId = req.user?.id;

    if (!customerId || !mongoose.Types.ObjectId.isValid(customerId)) {
      return res.status(400).json({ message: 'Valid customerId is required.' });
    }
    if (!approverId) {
      return res.status(401).json({ message: 'User not authenticated.' });
    }

    const approver = await User.findById(approverId).select('userRole').lean();
    if (!approver || !isSalesManagerRole(approver.userRole)) {
      return res.status(403).json({
        message: 'Only sales managers can approve quotations.',
      });
    }

    const customer = await Customer.findById(customerId).populate('user_id', 'fullName');
    if (!customer) {
      return res.status(404).json({ message: 'Customer not found.' });
    }

    const access = await assertSalesManagerCanAccessCustomer(approverId, customer);
    if (!access.ok) {
      return res.status(403).json({ message: access.message });
    }

    const uploadedQuotations = (customer.quotations || []).filter((q) => q.source === 'uploaded');
    if (!uploadedQuotations.length) {
      return res.status(400).json({ message: 'No uploaded quotation files to approve.' });
    }

    if (customer.quotationStatus === 'approved') {
      return res.status(400).json({ message: 'Quotation is already approved.' });
    }

    customer.quotationStatus = 'approved';
    customer.quotationApprovedBy = approverId;
    customer.quotationApprovedAt = new Date();
    await customer.save();

    await recordQuotationCustomerActivity(
      customer._id,
      approverId,
      'Quotation Approved',
      `Approved ${uploadedQuotations.length} uploaded quotation file(s).`
    );

    await createLog(
      'Quotation Approved',
      approverId,
      getCustomerDisplayName(customer),
      'Customer',
      customer._id
    );

    const quotationMeta = await formatCustomerQuotationMeta(customer);
    const formattedQuotations = await formatQuotationsForResponse(uploadedQuotations);

    return res.status(200).json({
      message: 'Quotation approved successfully.',
      ...quotationMeta,
      quotations: formattedQuotations,
    });
  } catch (error) {
    console.error('Approve quotation error:', error);
    return res.status(500).json({ message: 'Server error approving quotation.' });
  }
};
