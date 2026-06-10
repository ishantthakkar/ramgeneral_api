const mongoose = require('mongoose');
const Customer = require('../models/Customer');
const CustomerActivity = require('../models/CustomerActivity');
const Admin = require('../models/Admin');
const Survey = require('../models/Survey');
const User = require('../models/User');
const { createLog } = require('../utils/logger');
const { isSalesManagerRole, isSalesPersonRole } = require('../constants/userRoles');
const { enrichAreasWithProducts } = require('../utils/surveyProductUtils');
const {
  getQuotationAddresses,
  generatePdfBuffer,
  saveQuotationPdf,
} = require('../utils/quotationPdf');
const {
  buildGenerateQuotationRecord,
  generateUniqueQuotationNumber,
  buildUploadSignedQuotationRecord,
  getGenerateQuotationsForSurvey,
  getUploadSignedQuotationsForSurvey,
  hasUploadSignedQuotationForSurvey,
  formatQuotationListForResponse,
  formatQuotationListWithUserMap,
  loadUsersMap,
  mapUserFromId,
  attachQuotationFieldsToSurvey,
  uploadSignedQuotationSurveyFilter,
  surveyQuotationDataFilter,
  applySurveyQuotationStatusFilter,
} = require('../utils/quotationHelpers');

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

async function resolveSurveyById(surveyId, { requireAreas = false } = {}) {
  if (!surveyId || !mongoose.Types.ObjectId.isValid(surveyId)) {
    return { error: 'Valid surveyId is required.' };
  }

  const survey = await Survey.findById(surveyId);
  if (!survey) {
    return { error: 'Survey not found.' };
  }
  if (requireAreas && !survey.areas?.length) {
    return { error: 'Survey has no area line items.' };
  }

  return { survey };
}

async function formatSurveyQuotationMeta(survey) {
  const plain = survey?.toObject ? survey.toObject() : survey;
  const userIds = new Set();
  if (plain.quotationApprovedBy) userIds.add(plain.quotationApprovedBy.toString());
  const userMap = await loadUsersMap(userIds);

  return {
    surveyId: plain._id,
    customer_id: plain.customer_id,
    quotationStatus: plain.quotationStatus || 'pending',
    quotationApprovedBy: plain.quotationApprovedBy || null,
    quotationApprovedAt: plain.quotationApprovedAt || plain.confirmDate || null,
    confirmDate: plain.confirmDate || plain.quotationApprovedAt || null,
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

  const firstFixture = area.fixtures?.[0];
  return (
    firstFixture?.existingFixtureType ||
    firstFixture?.note ||
    area.note ||
    `Area ${index + 1}`
  );
}

async function buildLineItemsFromSurvey(survey) {
  const areas = await enrichAreasWithProducts(survey.areas || []);
  const lineItems = [];

  areas.forEach((area, areaIndex) => {
    const areaLabel = resolveAreaLabel(survey, area, areaIndex);
    const fixtures = area.fixtures?.length ? area.fixtures : [area];

    fixtures.forEach((fixture) => {
      const quantity = parseFloat(fixture.proposedQty) || 0;
      const unitPrice =
        parseFloat(fixture.price) ||
        fixture.product?.salesPrice ||
        fixture.product?.price ||
        0;
      const total = quantity * unitPrice;
      const proposedFixture =
        fixture.product?.name ||
        fixture.existingFixtureType ||
        fixture.existingBulbs ||
        'Fixture';

      lineItems.push({
        area: areaLabel,
        proposedFixture,
        quantity,
        unitPrice,
        total,
      });
    });
  });

  return lineItems.filter((row) => row.quantity > 0 || row.unitPrice > 0);
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

function toQuotationPdfUrls(items) {
  return (items || [])
    .map((q) => {
      const plain = q?.toObject ? q.toObject() : q;
      return (plain.url || '').trim();
    })
    .filter(Boolean);
}

function buildSurveyQuotationsList(surveys, customerMap) {
  return surveys.map((survey) => {
    const customer = customerMap.get(survey.customer_id?.toString());
    return {
      customerId: survey.customer_id,
      customerName: getCustomerDisplayName(customer),
      survey_id: survey._id,
      surveyName: survey.areaName || '',
      quotationStatus: survey.quotationStatus || 'pending',
      quotationApprovedAt: survey.quotationApprovedAt || null,
      quotationApprovedBy: survey.quotationApprovedBy || null,
      generateQuotation: toQuotationPdfUrls(
        getGenerateQuotationsForSurvey(survey, customer)
      ),
      uploadSignedQuotation: toQuotationPdfUrls(
        getUploadSignedQuotationsForSurvey(survey, customer)
      ),
    };
  });
}

async function resolveSurveyQuotationListScope(req) {
  const userId = req.user?.id;
  if (!userId) {
    return { error: 'User not authenticated.', status: 401 };
  }

  const filterSalesPersonId = req.query.salesPersonId || req.query.salesPerson;
  const admin = await Admin.findById(userId).select('email').lean();

  if (admin) {
    const customerFilter = {};
    if (filterSalesPersonId) {
      if (!mongoose.Types.ObjectId.isValid(filterSalesPersonId)) {
        return { error: 'Invalid salesPersonId.', status: 400 };
      }
      customerFilter.user_id = filterSalesPersonId;
    }
    return { role: 'admin', customerFilter, restrictToCustomers: !!filterSalesPersonId };
  }

  const user = await User.findById(userId).select('userRole fullName email').lean();
  if (!user) {
    return { error: 'Invalid authenticated user.', status: 401 };
  }

  if (isSalesManagerRole(user.userRole)) {
    const teamIds = await getTeamSalesPersonIds(userId);
    if (!teamIds.length) {
      return { role: 'manager', customerFilter: null, emptyMessage: 'No sales persons are assigned to you.' };
    }

    const customerFilter = { user_id: { $in: teamIds } };
    if (filterSalesPersonId) {
      if (!mongoose.Types.ObjectId.isValid(filterSalesPersonId)) {
        return { error: 'Invalid salesPersonId.', status: 400 };
      }
      const isOnTeam = teamIds.some((id) => id.toString() === filterSalesPersonId.toString());
      if (!isOnTeam) {
        return { error: 'Sales person is not on your team.', status: 403 };
      }
      customerFilter.user_id = filterSalesPersonId;
    }

    return { role: 'manager', customerFilter, restrictToCustomers: true };
  }

  if (isSalesPersonRole(user.userRole)) {
    if (filterSalesPersonId && filterSalesPersonId.toString() !== userId.toString()) {
      return { error: 'You can only view your own survey quotations.', status: 403 };
    }
    return {
      role: 'sales_person',
      customerFilter: { user_id: userId },
      restrictToCustomers: true,
    };
  }

  return {
    error: 'Only admin, sales manager, or sales person can view survey quotations.',
    status: 403,
  };
}

async function fetchSurveyQuotationsList(req) {
  const { quotationStatus, hasQuotations } = req.query;
  const statusFilter = quotationStatus
    ? quotationStatus.toString().trim().toLowerCase()
    : 'all';

  if (!['pending', 'approved', 'all'].includes(statusFilter)) {
    return { error: 'Invalid quotationStatus. Allowed: pending, approved, all.', status: 400 };
  }

  const scope = await resolveSurveyQuotationListScope(req);
  if (scope.error) {
    return { error: scope.error, status: scope.status };
  }

  if (scope.emptyMessage) {
    return { quotations: [], total: 0, role: scope.role, message: scope.emptyMessage };
  }

  let customerMap = new Map();
  const surveyFilter = {};

  const includeAllSurveys = hasQuotations === 'false' || hasQuotations === 'all';
  if (!includeAllSurveys) {
    Object.assign(surveyFilter, surveyQuotationDataFilter());
  }

  applySurveyQuotationStatusFilter(surveyFilter, statusFilter);

  if (scope.restrictToCustomers) {
    const customers = await Customer.find(scope.customerFilter)
      .select('name company accountNumber user_id leadId generateQuotation uploadSignedQuotation quotations')
      .populate('user_id', 'fullName email mobileNumber userRole')
      .populate('leadId', 'leadName name')
      .lean();

    const customerIds = customers.map((c) => c._id);
    if (!customerIds.length) {
      return { quotations: [], total: 0, role: scope.role };
    }

    customerMap = new Map(customers.map((c) => [c._id.toString(), c]));
    surveyFilter.customer_id = { $in: customerIds };
  }

  const surveys = await Survey.find(surveyFilter)
    .select(
      'customer_id areaName status generateQuotation uploadSignedQuotation quotationStatus quotationApprovedBy quotationApprovedAt confirmDate'
    )
    .sort({ updatedAt: -1 })
    .lean();

  if (!scope.restrictToCustomers && surveys.length) {
    const customerIds = [...new Set(surveys.map((s) => s.customer_id?.toString()).filter(Boolean))];
    const customers = await Customer.find({ _id: { $in: customerIds } })
      .select('name company accountNumber user_id leadId generateQuotation uploadSignedQuotation quotations')
      .populate('user_id', 'fullName email mobileNumber userRole')
      .populate('leadId', 'leadName name')
      .lean();
    customerMap = new Map(customers.map((c) => [c._id.toString(), c]));
  }

  const surveyQuotations = buildSurveyQuotationsList(surveys, customerMap);

  return {
    quotations: surveyQuotations,
    total: surveyQuotations.length,
    role: scope.role,
  };
}

exports.listSurveyQuotationsByUser = async (req, res) => {
  try {
    const result = await fetchSurveyQuotationsList(req);
    if (result.error) {
      return res.status(result.status).json({ message: result.error });
    }
    return res.status(200).json({
      quotations: result.quotations,
      total: result.total,
      ...(result.message ? { message: result.message } : {}),
    });
  } catch (error) {
    console.error('List survey quotations by user error:', error);
    return res.status(500).json({ message: 'Server error fetching survey quotations.' });
  }
};

exports.listQuotationsForManagerApproval = exports.listSurveyQuotationsByUser;

exports.listCustomerQuotationsForAdmin = exports.listSurveyQuotationsByUser;

exports.createQuotation = async (req, res) => {
  try {
    const surveyId = req.body?.surveyId || req.body?.survey_id;

    const surveyResult = await resolveSurveyById(surveyId, { requireAreas: true });
    if (surveyResult.error) {
      return res.status(404).json({ message: surveyResult.error });
    }

    const { survey } = surveyResult;
    const customerId = survey.customer_id;

    const customer = await Customer.findById(customerId)
      .populate('user_id', 'fullName mobileNumber email')
      .populate('leadId', 'leadName name')
      .lean();

    if (!customer) {
      return res.status(404).json({ message: 'Customer not found for this survey.' });
    }

    const lineItems = await buildLineItemsFromSurvey(survey);

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
    const { filename, relativePath } = await saveQuotationPdf(pdfBuffer, survey._id);
    const pdfUrl = `${API_BASE_URL}/${relativePath}`;

    const generator = req.user?.id
      ? await User.findById(req.user.id).select('fullName email').lean()
      : null;

    const quotationNumber = await generateUniqueQuotationNumber();

    const quotationRecord = buildGenerateQuotationRecord({
      customer_id: customerId,
      quotationNumber,
      url: pdfUrl,
      filename,
      surveyId: survey._id,
      grandTotal,
      uploadedBy: req.user?.id,
      uploadedByName: generator?.fullName || '',
    });

    const updatedSurvey = await Survey.findByIdAndUpdate(
      survey._id,
      { $push: { generateQuotation: quotationRecord } },
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

    const savedQuotation =
      updatedSurvey.generateQuotation[updatedSurvey.generateQuotation.length - 1];

    return res.status(201).json({
      message: 'Quotation generated successfully.',
      survey_id: updatedSurvey._id,
      customerId: updatedSurvey.customer_id,
      quotationNumber: savedQuotation.quotationNumber,
      pdfUrl: savedQuotation.url,
      generateQuotation: toQuotationPdfUrls([savedQuotation]),
    });
  } catch (error) {
    console.error('Create quotation error:', error);
    return res.status(500).json({ message: 'Server error generating quotation PDF.' });
  }
};

exports.uploadQuotation = async (req, res) => {
  try {
    const surveyId = req.body?.surveyId || req.body?.survey_id;

    const surveyResult = await resolveSurveyById(surveyId);
    if (surveyResult.error) {
      return res.status(404).json({ message: surveyResult.error });
    }

    const files = req.files || [];
    if (!files.length) {
      return res.status(400).json({
        message: 'At least one quotation file is required (PDF or image).',
      });
    }

    const { survey } = surveyResult;
    const customerId = survey.customer_id;

    const customer = await Customer.findById(customerId);
    if (!customer) {
      return res.status(404).json({ message: 'Customer not found for this survey.' });
    }

    const uploader = req.user?.id
      ? await User.findById(req.user.id).select('fullName email mobileNumber').lean()
      : null;
    const uploadedByName = uploader?.fullName || req.user?.email || '';

    const quotationRecords = files.map((file) => {
      const relativePath = `uploads/quotations/${file.filename}`;
      const pdfName = file.originalname || file.filename;
      return buildUploadSignedQuotationRecord({
        customer_id: customerId,
        surveyId: survey._id,
        url: `${API_BASE_URL}/${relativePath}`,
        filename: file.filename,
        pdfName,
        mimeType: file.mimetype,
        uploadedBy: req.user?.id,
        uploadedByName,
      });
    });

    const updatedSurvey = await Survey.findByIdAndUpdate(
      survey._id,
      {
        $push: { uploadSignedQuotation: { $each: quotationRecords } },
        quotationStatus: 'pending',
        quotationApprovedBy: null,
        quotationApprovedAt: null,
      },
      { new: true }
    );

    if (req.user?.id) {
      await recordQuotationCustomerActivity(
        customer._id,
        req.user.id,
        'Quotation Uploaded',
        `Uploaded ${quotationRecords.length} signed quotation file(s) for survey.`
      );
      await createLog(
        'Quotation Uploaded',
        req.user.id,
        getCustomerDisplayName(customer),
        'Customer',
        customer._id
      );
    }

    const savedQuotations = updatedSurvey.uploadSignedQuotation.slice(-quotationRecords.length);

    return res.status(201).json({
      message: 'Quotation received successfully.',
      survey_id: updatedSurvey._id,
      customerId: updatedSurvey.customer_id,
      quotationStatus: updatedSurvey.quotationStatus || 'pending',
      uploadSignedQuotation: toQuotationPdfUrls(savedQuotations),
    });
  } catch (error) {
    console.error('Upload quotation error:', error);
    return res.status(500).json({ message: 'Server error uploading quotation files.' });
  }
};

exports.approveQuotation = async (req, res) => {
  try {
    const surveyId = req.body?.surveyId || req.body?.survey_id;
    const approverId = req.user?.id;

    if (!approverId) {
      return res.status(401).json({ message: 'User not authenticated.' });
    }

    const surveyResult = await resolveSurveyById(surveyId);
    if (surveyResult.error) {
      return res.status(404).json({ message: surveyResult.error });
    }

    const { survey } = surveyResult;
    const customer = await Customer.findById(survey.customer_id).populate('user_id', 'fullName');
    if (!customer) {
      return res.status(404).json({ message: 'Customer not found for this survey.' });
    }

    const admin = await Admin.findById(approverId).select('_id').lean();
    if (!admin) {
      const approver = await User.findById(approverId).select('userRole').lean();
      if (!approver || !isSalesManagerRole(approver.userRole)) {
        return res.status(403).json({
          message: 'Only admins and sales managers can approve quotations.',
        });
      }

      const access = await assertSalesManagerCanAccessCustomer(approverId, customer);
      if (!access.ok) {
        return res.status(403).json({ message: access.message });
      }
    }

    // const uploadedQuotations = getUploadSignedQuotationsForSurvey(survey, customer);
    // if (!hasUploadSignedQuotationForSurvey(survey, customer)) {
    //   return res.status(400).json({ message: 'No uploaded quotation files to approve for this survey.' });
    // }

    if (survey.quotationStatus === 'approved') {
      return res.status(400).json({ message: 'Quotation is already approved for this survey.' });
    }

    const approvedAt = new Date();

    const updatedSurvey = await Survey.findByIdAndUpdate(
      survey._id,
      {
        quotationStatus: 'approved',
        quotationApprovedBy: approverId,
        quotationApprovedAt: approvedAt,
        confirmDate: approvedAt,
      },
      { new: true }
    );

    await recordQuotationCustomerActivity(
      customer._id,
      approverId,
      'Quotation Approved',
      `Approved ${uploadedQuotations.length} uploaded quotation file(s) for survey.`
    );

    await createLog(
      'Quotation Approved',
      approverId,
      getCustomerDisplayName(customer),
      'Customer',
      customer._id
    );

    const quotationMeta = await formatSurveyQuotationMeta(updatedSurvey);

    return res.status(200).json({
      message: 'Quotation approved successfully.',
      survey_id: updatedSurvey._id,
      customerId: updatedSurvey.customer_id,
      quotationStatus: quotationMeta.quotationStatus,
      quotationApprovedAt: quotationMeta.quotationApprovedAt,
      confirmDate: quotationMeta.confirmDate,
      quotationApprovedBy: quotationMeta.quotationApprovedBy,
    });
  } catch (error) {
    console.error('Approve quotation error:', error);
    return res.status(500).json({ message: 'Server error approving quotation.' });
  }
};
