const Customer = require('../models/Customer');
const Survey = require('../models/Survey');
const { createLog } = require('../utils/logger');
const { generatePdfBuffer, saveInvoicePdf } = require('../utils/quotationPdf');
const {
  generateUniqueInvoiceNumber,
  getGenerateInvoiceForSurvey,
  surveyInvoiceDataFilter,
  surveyInvoiceEligibilityFilter,
  applySurveyInvoiceStatusFilter,
  attachInvoiceFieldsToSurvey,
  toInvoicePdfUrl,
  roundMoney,
  sumInvoicePayments,
  getInvoicePaymentTotals,
  mapInvoicePayments,
  addInvoicePayment,
} = require('../utils/invoiceHelpers');
const { getLatestQuotationNumberForSurvey } = require('../utils/quotationHelpers');
const {
  resolveSurveyById,
  buildQuotationPreviewData,
  getCustomerDisplayName,
  resolveSurveyQuotationListScope,
} = require('./quotationController');

const API_BASE_URL = process.env.API_BASE_URL || 'https://ramgeneral-api.onrender.com';

function resolveCustomerLeadId(customer) {
  const lead = customer?.leadId && typeof customer.leadId === 'object' ? customer.leadId : null;
  return (lead?.lead_id || '').toString().trim();
}

function buildSurveyInvoicesList(surveys, customerMap) {
  return surveys.map((survey) => {
    const customer = customerMap.get(survey.customer_id?.toString());
    const invoiceFilename = getGenerateInvoiceForSurvey(survey);
    const invoiceAmount = roundMoney(Number(survey.invoiceAmount) || 0);
    const paidAmount = roundMoney(sumInvoicePayments(survey));
    const pendingAmount = roundMoney(Math.max(0, invoiceAmount - paidAmount));

    return {
      customerId: survey.customer_id,
      customerName: getCustomerDisplayName(customer),
      lead_id: resolveCustomerLeadId(customer),
      survey_id: survey._id,
      surveyName: (survey.surveyName || survey.areaName || '').trim(),
      invoiceNumber: survey.invoiceNumber || '',
      invoiceStatus: survey.invoiceStatus || 'pending',
      invoiceDate: invoiceFilename ? survey.invoiceGeneratedAt || survey.updatedAt || null : null,
      generateInvoice: invoiceFilename ? toInvoicePdfUrl(invoiceFilename) : '',
      invoiceAmount,
      paidAmount,
      pendingAmount,
    };
  });
}

async function fetchSurveyInvoicesList(req) {
  const { invoiceStatus, hasInvoices } = req.query;
  const statusFilter = invoiceStatus ? invoiceStatus.toString().trim().toLowerCase() : 'all';

  if (!['pending', 'approved', 'fully_paid', 'all'].includes(statusFilter)) {
    return { error: 'Invalid invoiceStatus. Allowed: pending, approved, fully_paid, all.', status: 400 };
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

  Object.assign(surveyFilter, surveyInvoiceEligibilityFilter());

  applySurveyInvoiceStatusFilter(surveyFilter, statusFilter);

  if (scope.restrictToCustomers) {
    const customers = await Customer.find(scope.customerFilter)
      .select('name company accountNumber customerCode user_id leadId')
      .populate('user_id', 'fullName email mobileNumber userRole')
      .populate('leadId', 'lead_id leadName name')
      .lean();

    const customerIds = customers.map((c) => c._id);
    if (!customerIds.length) {
      return { invoices: [], total: 0, role: scope.role };
    }

    customerMap = new Map(customers.map((c) => [c._id.toString(), c]));
    surveyFilter.customer_id = { $in: customerIds };
  }

  const surveys = await Survey.find(surveyFilter)
    .select(
      'customer_id surveyName areaName status generateInvoice invoiceNumber invoiceStatus invoiceGeneratedAt invoiceAmount invoicePayments updatedAt'
    )
    .sort({ updatedAt: -1 })
    .lean();

  if (!scope.restrictToCustomers && surveys.length) {
    const customerIds = [...new Set(surveys.map((s) => s.customer_id?.toString()).filter(Boolean))];
    const customers = await Customer.find({ _id: { $in: customerIds } })
      .select('name company accountNumber customerCode user_id leadId')
      .populate('user_id', 'fullName email mobileNumber userRole')
      .populate('leadId', 'lead_id leadName name')
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
      .populate('leadId', 'lead_id leadName name')
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

    if (String(survey.inspectionStatus || '').toLowerCase() !== 'verified') {
      return res.status(400).json({
        message: 'Inspection must be approved by admin before generating an invoice.',
      });
    }

    if (String(survey.quotationStatus || '').toLowerCase() !== 'approved') {
      return res.status(400).json({
        message: 'Quotation must be approved before generating an invoice.',
      });
    }

    const customerId = survey.customer_id;

    const customer = await Customer.findById(customerId)
      .populate('user_id', 'fullName mobileNumber email')
      .populate('leadId', 'lead_id leadName name')
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
      job_id: survey.job_id || '',
    };

    const pdfBuffer = await generatePdfBuffer(pdfData);
    const { filename, relativePath } = await saveInvoicePdf(pdfBuffer, survey._id);
    const pdfUrl = `${API_BASE_URL}/${relativePath}`;

    const generatedAt = new Date();
    const updatedSurvey = await Survey.findByIdAndUpdate(
      survey._id,
      {
        $set: {
          invoiceNumber,
          generateInvoice: filename,
          invoiceStatus: 'approved',
          invoiceGeneratedAt: generatedAt,
          invoiceAmount: roundMoney(preview.grandTotal || 0),
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

exports.addInvoicePayment = async (req, res) => {
  try {
    const surveyId = req.body?.surveyId || req.body?.survey_id;
    const { amount, paymentMethod, paymentDate, note } = req.body;

    const surveyResult = await resolveSurveyById(surveyId);
    if (surveyResult.error) {
      return res.status(404).json({ message: surveyResult.error });
    }

    const { survey } = surveyResult;

    const customer = await Customer.findById(survey.customer_id)
      .populate('user_id', 'fullName mobileNumber email')
      .populate('leadId', 'lead_id leadName name')
      .lean();

    if (!customer) {
      return res.status(404).json({ message: 'Customer not found for this survey.' });
    }

    let invoiceAmount = roundMoney(Number(survey.invoiceAmount) || 0);
    if (!invoiceAmount) {
      const preview = await buildQuotationPreviewData(survey, customer);
      if (preview.error) {
        return res.status(400).json({ message: preview.error });
      }
      invoiceAmount = roundMoney(preview.grandTotal || 0);
      if (invoiceAmount > 0) {
        survey.invoiceAmount = invoiceAmount;
      }
    }

    const result = await addInvoicePayment(
      survey,
      { amount, paymentMethod, paymentDate, note },
      invoiceAmount
    );

    if (req.user?.id && customer) {
      await createLog(
        'Invoice Payment Added',
        req.user.id,
        getCustomerDisplayName(customer),
        'Customer',
        customer._id
      );
    }

    return res.status(200).json({
      message:
        result.pending <= 0
          ? 'Invoice marked as fully paid successfully.'
          : 'Invoice payment recorded successfully.',
      survey_id: survey._id,
      invoiceStatus: result.invoiceStatus,
      invoicePaidAt: result.invoicePaidAt,
      invoiceAmount: result.invoiceAmount,
      paidAmount: result.paid,
      pendingAmount: result.pending,
      payment: result.payment,
      payments: mapInvoicePayments(survey),
    });
  } catch (error) {
    console.error('Add invoice payment error:', error);
    const status = error.statusCode || 500;
    return res.status(status).json({
      message: error.message || 'Server error recording invoice payment.',
    });
  }
};

exports.markInvoiceFullyPaid = exports.addInvoicePayment;
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
      .populate('leadId', 'lead_id leadName name')
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
    let invoiceAmount = roundMoney(
      Number(survey.invoiceAmount) || estimate.grandTotal || 0
    );
    if (!Number(survey.invoiceAmount) && invoiceAmount > 0) {
      survey.invoiceAmount = invoiceAmount;
      await survey.save();
    }
    const paymentTotals = getInvoicePaymentTotals(survey, invoiceAmount);
    const payments = mapInvoicePayments(survey);

    return res.status(200).json({
      message: 'Survey invoice details retrieved successfully.',
      survey_id: survey._id,
      customerId: survey.customer_id,
      customerName: getCustomerDisplayName(customer),
      lead_id: resolveCustomerLeadId(customer),
      surveyName: (survey.surveyName || survey.areaName || '').trim(),
      invoiceNumber: invoiceFields.invoiceNumber,
      invoiceStatus: invoiceFields.invoiceStatus,
      invoiceDate: invoiceFields.generateInvoice
        ? survey.invoiceGeneratedAt || survey.updatedAt || null
        : null,
      generateInvoice: invoiceFields.generateInvoice,
      invoiceAmount: paymentTotals.invoiceAmount,
      paidAmount: paymentTotals.paid,
      pendingAmount: paymentTotals.pending,
      payments,
      estimate,
    });
  } catch (error) {
    console.error('Get survey invoice details error:', error);
    return res.status(500).json({ message: 'Server error fetching survey invoice details.' });
  }
};
