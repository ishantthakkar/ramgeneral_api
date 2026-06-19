const Customer = require('../models/Customer');
const Survey = require('../models/Survey');
const { createLog } = require('../utils/logger');
const { generatePdfBuffer, saveInvoicePdf } = require('../utils/quotationPdf');
const {
  generateUniqueInvoiceNumber,
  getGenerateInvoiceForSurvey,
  surveyInvoiceDataFilter,
  applySurveyInvoiceStatusFilter,
  attachInvoiceFieldsToSurvey,
  toInvoicePdfUrl,
} = require('../utils/invoiceHelpers');
const { getLatestQuotationNumberForSurvey } = require('../utils/quotationHelpers');
const {
  resolveSurveyById,
  buildQuotationPreviewData,
  getCustomerDisplayName,
  resolveSurveyQuotationListScope,
} = require('./quotationController');

const API_BASE_URL = process.env.API_BASE_URL || 'https://ramgeneral-api.onrender.com';

function buildSurveyInvoicesList(surveys, customerMap) {
  return surveys.map((survey) => {
    const customer = customerMap.get(survey.customer_id?.toString());
    const invoiceFilename = getGenerateInvoiceForSurvey(survey);

    return {
      customerId: survey.customer_id,
      customerName: getCustomerDisplayName(customer),
      survey_id: survey._id,
      surveyName: (survey.surveyName || survey.areaName || '').trim(),
      invoiceNumber: survey.invoiceNumber || '',
      invoiceStatus: survey.invoiceStatus || 'pending',
      generateInvoice: invoiceFilename ? toInvoicePdfUrl(invoiceFilename) : '',
    };
  });
}

async function fetchSurveyInvoicesList(req) {
  const { invoiceStatus, hasInvoices } = req.query;
  const statusFilter = invoiceStatus ? invoiceStatus.toString().trim().toLowerCase() : 'all';

  if (!['pending', 'approved', 'all'].includes(statusFilter)) {
    return { error: 'Invalid invoiceStatus. Allowed: pending, approved, all.', status: 400 };
  }

  const scope = await resolveSurveyQuotationListScope(req);
  if (scope.error) {
    return { error: scope.error, status: scope.status };
  }

  if (scope.emptyMessage) {
    return { invoices: [], total: 0, role: scope.role, message: scope.emptyMessage };
  }

  let customerMap = new Map();
  const surveyFilter = {};

  const includeAllSurveys = hasInvoices === 'false' || hasInvoices === 'all';
  if (!includeAllSurveys) {
    Object.assign(surveyFilter, surveyInvoiceDataFilter());
  }

  applySurveyInvoiceStatusFilter(surveyFilter, statusFilter);

  if (scope.restrictToCustomers) {
    const customers = await Customer.find(scope.customerFilter)
      .select('name company accountNumber user_id leadId')
      .populate('user_id', 'fullName email mobileNumber userRole')
      .populate('leadId', 'leadName name')
      .lean();

    const customerIds = customers.map((c) => c._id);
    if (!customerIds.length) {
      return { invoices: [], total: 0, role: scope.role };
    }

    customerMap = new Map(customers.map((c) => [c._id.toString(), c]));
    surveyFilter.customer_id = { $in: customerIds };
  }

  const surveys = await Survey.find(surveyFilter)
    .select('customer_id surveyName areaName status generateInvoice invoiceNumber invoiceStatus')
    .sort({ updatedAt: -1 })
    .lean();

  if (!scope.restrictToCustomers && surveys.length) {
    const customerIds = [...new Set(surveys.map((s) => s.customer_id?.toString()).filter(Boolean))];
    const customers = await Customer.find({ _id: { $in: customerIds } })
      .select('name company accountNumber user_id leadId')
      .populate('user_id', 'fullName email mobileNumber userRole')
      .populate('leadId', 'leadName name')
      .lean();
    customerMap = new Map(customers.map((c) => [c._id.toString(), c]));
  }

  const surveyInvoices = buildSurveyInvoicesList(surveys, customerMap);

  return {
    invoices: surveyInvoices,
    total: surveyInvoices.length,
    role: scope.role,
  };
}

exports.listSurveyInvoicesByUser = async (req, res) => {
  try {
    const result = await fetchSurveyInvoicesList(req);
    if (result.error) {
      return res.status(result.status).json({ message: result.error });
    }
    return res.status(200).json({
      invoices: result.invoices,
      total: result.total,
      ...(result.message ? { message: result.message } : {}),
    });
  } catch (error) {
    console.error('List survey invoices error:', error);
    return res.status(500).json({ message: 'Server error fetching survey invoices.' });
  }
};

exports.previewInvoice = async (req, res) => {
  try {
    const surveyId = req.body?.surveyId || req.body?.survey_id || req.query?.surveyId || req.query?.survey_id;

    const surveyResult = await resolveSurveyById(surveyId, { requireAreas: true });
    if (surveyResult.error) {
      return res.status(404).json({ message: surveyResult.error });
    }

    const { survey } = surveyResult;

    const customer = await Customer.findById(survey.customer_id)
      .populate('user_id', 'fullName mobileNumber email')
      .populate('leadId', 'leadName name')
      .lean();

    if (!customer) {
      return res.status(404).json({ message: 'Customer not found for this survey.' });
    }

    const preview = await buildQuotationPreviewData(survey, customer);
    if (preview.error) {
      return res.status(400).json({ message: preview.error });
    }

    const invoiceFields = attachInvoiceFieldsToSurvey(survey);
    const { flatLineItems, ...estimate } = preview;

    return res.status(200).json({
      message: 'Invoice preview retrieved successfully.',
      invoiceNumber: invoiceFields.invoiceNumber,
      invoiceStatus: invoiceFields.invoiceStatus,
      generateInvoice: invoiceFields.generateInvoice,
      estimate,
    });
  } catch (error) {
    console.error('Preview invoice error:', error);
    return res.status(500).json({ message: 'Server error previewing invoice.' });
  }
};

exports.createInvoice = async (req, res) => {
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

    const preview = await buildQuotationPreviewData(survey, customer);
    if (preview.error) {
      return res.status(400).json({ message: preview.error });
    }

    const invoiceNumber = await generateUniqueInvoiceNumber();
    const quotationNumber = getLatestQuotationNumberForSurvey(survey, customer);

    const { flatLineItems, ...previewFields } = preview;
    const pdfData = {
      ...previewFields,
      lineItems: flatLineItems,
      documentType: 'invoice',
      invoiceNumber,
      quotationNumber,
    };

    const pdfBuffer = await generatePdfBuffer(pdfData);
    const { filename, relativePath } = await saveInvoicePdf(pdfBuffer, survey._id);
    const pdfUrl = `${API_BASE_URL}/${relativePath}`;

    const updatedSurvey = await Survey.findByIdAndUpdate(
      survey._id,
      {
        $set: {
          invoiceNumber,
          generateInvoice: filename,
        },
      },
      { new: true }
    );

    if (req.user?.id) {
      await createLog(
        'Invoice Generated',
        req.user.id,
        getCustomerDisplayName(customer),
        'Customer',
        customer._id
      );
    }

    return res.status(201).json({
      message: 'Invoice generated successfully.',
      invoiceNumber: updatedSurvey.invoiceNumber,
      pdfUrl,
      filename,
    });
  } catch (error) {
    console.error('Create invoice error:', error);
    return res.status(500).json({ message: 'Server error generating invoice PDF.' });
  }
};

exports.getSurveyInvoiceDetails = async (req, res) => {
  try {
    const surveyId = req.body?.surveyId || req.body?.survey_id || req.query?.surveyId || req.query?.survey_id;

    const surveyResult = await resolveSurveyById(surveyId, { requireAreas: true });
    if (surveyResult.error) {
      return res.status(404).json({ message: surveyResult.error });
    }

    const { survey } = surveyResult;

    const customer = await Customer.findById(survey.customer_id)
      .populate('user_id', 'fullName mobileNumber email')
      .populate('leadId', 'leadName name')
      .lean();

    if (!customer) {
      return res.status(404).json({ message: 'Customer not found for this survey.' });
    }

    const preview = await buildQuotationPreviewData(survey, customer);
    if (preview.error) {
      return res.status(400).json({ message: preview.error });
    }

    const invoiceFields = attachInvoiceFieldsToSurvey(survey);
    const { flatLineItems, ...estimate } = preview;

    return res.status(200).json({
      message: 'Survey invoice details retrieved successfully.',
      survey_id: survey._id,
      customerId: survey.customer_id,
      invoiceNumber: invoiceFields.invoiceNumber,
      invoiceStatus: invoiceFields.invoiceStatus,
      generateInvoice: invoiceFields.generateInvoice,
      estimate,
    });
  } catch (error) {
    console.error('Get survey invoice details error:', error);
    return res.status(500).json({ message: 'Server error fetching survey invoice details.' });
  }
};
