const mongoose = require('mongoose');
const Customer = require('../models/Customer');
const Survey = require('../models/Survey');
const { createLog } = require('../utils/logger');
const { enrichAreasWithProducts } = require('../utils/surveyProductUtils');
const {
  getQuotationAddresses,
  generatePdfBuffer,
  saveQuotationPdf,
} = require('../utils/quotationPdf');

const API_BASE_URL = process.env.API_BASE_URL || 'https://ramgeneral-api.onrender.com';

function getCompanyInfo() {
  return {
    name: process.env.COMPANY_NAME || 'RAM GENERAL SUPPLY',
    address: process.env.COMPANY_ADDRESS || '245 East 17th Street Paterson, NJ 07524',
    phone: process.env.COMPANY_PHONE || '(123) 456 7890',
    email: process.env.COMPANY_EMAIL || 'ramgeneral@123.gmail.com',
  };
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

    const subtotal = lineItems.reduce((sum, row) => sum + row.total, 0);
    const taxRate = Number(process.env.QUOTATION_TAX_RATE || 0.1);
    const taxAmount = subtotal * taxRate;
    const grandTotal = subtotal + taxAmount;

    const primaryContact = (customer.contactInfo || [])[0] || {};
    const salesPerson = customer.user_id || {};

    const { serviceAddress, billingAddress } = getQuotationAddresses(customer);

    const pdfData = {
      company: getCompanyInfo(),
      generatedDate: new Date(),
      serviceAddress,
      billingAddress,
      salesPerson: {
        name: salesPerson.fullName || customer.createdByName || '',
        phone: salesPerson.mobileNumber || customer.mobileNumber || '',
      },
      customerContact: {
        name: primaryContact.name || customer.name || customer.leadName || '',
        phone: primaryContact.phone || primaryContact.mobile || customer.mobileNumber || '',
        email: primaryContact.email || customer.email || '',
      },
      lineItems,
      subtotal,
      taxRate,
      taxAmount,
      grandTotal,
    };

    const pdfBuffer = await generatePdfBuffer(pdfData);
    const { filename, relativePath } = await saveQuotationPdf(pdfBuffer, customerId);
    const pdfUrl = `${API_BASE_URL}/${relativePath}`;

    const quotationRecord = {
      url: pdfUrl,
      filename,
      mimeType: 'application/pdf',
      source: 'generated',
      surveyId: surveys[0]._id,
      subtotal,
      taxAmount,
      grandTotal,
      createdAt: new Date(),
    };

    await Customer.findByIdAndUpdate(customerId, {
      $push: { quotations: quotationRecord },
    });

    if (req.user?.id) {
      await createLog(
        'Quotation Generated',
        req.user.id,
        customer.name || customer.leadName || 'Customer',
        'Customer',
        customer._id
      );
    }

    return res.status(201).json({ pdfUrl });
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

    const quotationRecords = files.map((file) => {
      const relativePath = `uploads/quotations/${file.filename}`;
      return {
        url: `${API_BASE_URL}/${relativePath}`,
        filename: file.filename,
        mimeType: file.mimetype,
        source: 'uploaded',
        createdAt: new Date(),
      };
    });

    await Customer.findByIdAndUpdate(customerId, {
      $push: { quotations: { $each: quotationRecords } },
    });

    if (req.user?.id) {
      await createLog(
        'Quotation Uploaded',
        req.user.id,
        customer.name || customer.leadName || 'Customer',
        'Customer',
        customer._id
      );
    }

    const pdfUrls = quotationRecords.map((q) => q.url);
    return res.status(201).json({
      message: 'Quotation received successfully.',
      pdfUrls,
    });
  } catch (error) {
    console.error('Upload quotation error:', error);
    return res.status(500).json({ message: 'Server error uploading quotation files.' });
  }
};
