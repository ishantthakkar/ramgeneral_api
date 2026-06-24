const mongoose = require('mongoose');
const Customer = require('../models/Customer');
const Lead = require('../models/Lead');
const Survey = require('../models/Survey');
const User = require('../models/User');
const Product = require('../models/Product');
const CustomerActivity = require('../models/CustomerActivity');
const { createLog } = require('../utils/logger');
const { resolveLeadSourceCode } = require('../constants/leadSources');
const {
  tryParseJson,
  mergeSubdocuments,
  normalizeAddresses,
  normalizeContactInfo,
  normalizeNotes,
  normalizeBillFilenames,
  resolveNewBillFilenames,
  parseContactInput,
  resolveContactBusinessCardUploads,
  resolveStandaloneBusinessCardUploads,
  upsertContactInfo,
  formatContactForResponse,
  parseAddressInput,
  upsertAddresses,
  formatAddressForResponse,
  buildNoteEntry,
  attachUserIdToNotes,
  enrichNotesWithAuthors,
  enrichNotesForManyRecords,
} = require('../utils/subdocumentHelpers');
const path = require('path');
const fs = require('fs');
const {
  LEAD_FIELDS_FOR_POPULATE,
  syncLeadFieldsFromBody,
  stripCustomerLogFields,
} = require('../utils/customerLeadHelpers');
const { isSalesManagerRole } = require('../constants/userRoles');
const {
  attachSurveysWithQuotations,
  stripCustomerQuotationFields,
} = require('../utils/quotationHelpers');
const {
  calculateSurveyPayables,
  getInstallDate,
  getPaymentTotals,
  syncPayablesForCustomer,
  addPaymentToCommission,
  normalizePayableFor,
  sumCommissionPayments,
  findCommissionRecord,
  resolveSurveyContractorName,
  resolveSurveySalesPersonName,
  resolveSurveySalesManagerName,
  resolvePayableAmount,
  getCommissionMilestones,
} = require('../utils/payablesUtils');

function mapUserSummary(user) {
  if (!user) return null;
  const id = user._id || user;
  return {
    id,
    fullName: user.fullName || '',
    email: user.email || '',
    mobileNumber: user.mobileNumber || '',
    userRole: user.userRole || '',
  };
}
const { enrichAreasWithProducts } = require('../utils/surveyProductUtils');
const { applySurveySiteUpdates } = require('../utils/surveySiteUpdate');
const { enrichSurveyNotesInObject } = require('../utils/surveyNotes');

async function formatSurveysForResponse(surveys, surveyBaseUrl) {
  return Promise.all(
    surveys.map(async (survey) => {
      const surveyObj = survey.toObject ? survey.toObject() : survey;
      surveyObj.areas = await enrichAreasWithProducts(surveyObj.areas || []);
      surveyObj.areas = await Promise.all(
        (surveyObj.areas || []).map(async (area) => ({
          ...area,
          images: (area.images || []).map((img) => {
            const filename = String(img || '').replace(/^\//, '');
            if (!filename) return img;
            if (filename.startsWith('http')) return filename;
            return `${surveyBaseUrl}${filename}`;
          }),
          verification_notes: await enrichNotesWithAuthors(area.verification_notes || []),
          fixtures: (area.fixtures || []).map((fixture) => ({
            ...fixture,
            images: (fixture.images || []).map((img) => {
              const filename = String(img || '').replace(/^\//, '');
              if (!filename) return img;
              if (filename.startsWith('http')) return filename;
              return `${surveyBaseUrl}${filename}`;
            }),
            report: fixture.report
              ? {
                  ...fixture.report,
                  images: (fixture.report.images || []).map((img) => {
                    const filename = String(img || '').replace(/^\//, '');
                    if (!filename) return img;
                    if (filename.startsWith('http')) return filename;
                    return `${surveyBaseUrl}${filename}`;
                  }),
                }
              : fixture.report,
            verification: fixture.verification
              ? {
                  ...fixture.verification,
                  images: (fixture.verification.images || []).map((img) => {
                    const filename = String(img || '').replace(/^\//, '');
                    if (!filename) return img;
                    if (filename.startsWith('http')) return filename;
                    return `${surveyBaseUrl}${filename}`;
                  }),
                }
              : fixture.verification,
          })),
        }))
      );
      if (Array.isArray(surveyObj.images)) {
        surveyObj.images = surveyObj.images.map((img) => {
          const filename = String(img || '').replace(/^\//, '');
          if (!filename) return img;
          if (filename.startsWith('http')) return filename;
          return `${surveyBaseUrl}${filename}`;
        });
      }
      return enrichSurveyNotesInObject(surveyObj);
    })
  );
}

async function formatCustomerForSurveyResponse(customer, materialBaseUrl) {
  if (!customer) return null;

  const source = customer.toObject ? customer.toObject() : customer;
  const customerObj = stripCustomerLogFields(source);
  const lead = source.leadId && typeof source.leadId === 'object' ? source.leadId : null;

  customerObj.dba =
    (source.dba ?? customerObj.dba ?? '').toString().trim() ||
    (source.company ?? customerObj.company ?? '').toString().trim() ||
    (lead?.dba ?? '').toString().trim() ||
    '';

  if (customerObj.material && Array.isArray(customerObj.material)) {
    customerObj.material = customerObj.material.map((item) => ({
      ...item,
      images: (item.images || []).map((img) => `${materialBaseUrl}${img}`),
    }));
  }

  if (Array.isArray(customerObj.contactInfo)) {
    customerObj.contactInfo = customerObj.contactInfo.map(formatContactForResponse);
  }
  if (Array.isArray(customerObj.addresses)) {
    customerObj.addresses = customerObj.addresses.map(formatAddressForResponse);
  }
  if (Array.isArray(customerObj.notes)) {
    customerObj.notes = await enrichNotesWithAuthors(customerObj.notes);
  }

  return customerObj;
}

function parseFixtureHeightInches(heightFt, heightIn) {
  const ft = parseFloat(heightFt) || 0;
  const inches = parseFloat(heightIn) || 0;
  return ft * 12 + inches;
}

function buildMaterialSummaryFromAreas(areas) {
  const summaryMap = new Map();

  for (const area of areas || []) {
    for (const fixture of area.fixtures || []) {
      const product = fixture.product;
      const productKey =
        product?._id?.toString() ||
        fixture.product_id?.toString?.() ||
        fixture.product_id ||
        fixture.existingFixtureType ||
        'unknown';

      const sku =
        (product?.sku ?? product?.name ?? fixture.existingFixtureType ?? '')
          .toString()
          .trim();
      if (!sku) continue;

      const qty =
        parseFloat(fixture.proposedQty) || parseFloat(fixture.existingQty) || 0;
      const heightInches = parseFixtureHeightInches(fixture.heightFt, fixture.heightIn);

      if (!summaryMap.has(productKey)) {
        summaryMap.set(productKey, {
          sku,
          qty: 0,
          maxHeightInches: 0,
          heightFt: fixture.heightFt || '',
          heightIn: fixture.heightIn || '',
        });
      }

      const entry = summaryMap.get(productKey);
      entry.qty += qty;

      if (heightInches >= entry.maxHeightInches) {
        entry.maxHeightInches = heightInches;
        entry.heightFt = fixture.heightFt || '';
        entry.heightIn = fixture.heightIn || '';
      }
    }
  }

  return Array.from(summaryMap.values()).map(({ sku, qty, heightFt, heightIn }) => ({
    sku,
    qty: String(Math.round(qty)).padStart(2, '0'),
    heightFt: (heightFt ?? '').toString().trim() || '0',
    heightIn: (heightIn ?? '').toString().trim() || '0',
  }));
}

function buildDeliverySummary(areas, materialDelivery) {
  const proposedBySku = new Map();
  const deliveredBySku = new Map();

  for (const area of areas || []) {
    for (const fixture of area.fixtures || []) {
      const product = fixture.product;
      const sku =
        (product?.sku ?? product?.name ?? fixture.existingFixtureType ?? '')
          .toString()
          .trim();
      if (!sku) continue;

      const proposedQty =
        parseFloat(fixture.proposedQty) || parseFloat(fixture.existingQty) || 0;
      proposedBySku.set(sku, (proposedBySku.get(sku) || 0) + proposedQty);
    }
  }

  for (const delivery of materialDelivery || []) {
    const plain = delivery?.toObject ? delivery.toObject() : delivery;
    if (plain.deliveryStatus !== 'delivered') continue;

    for (const item of plain.items || []) {
      const sku = (item?.sku ?? '').toString().trim();
      if (!sku) continue;
      const deliveredQty = Number(item?.issued_qty ?? item?.issuedQty ?? 0) || 0;
      deliveredBySku.set(sku, (deliveredBySku.get(sku) || 0) + deliveredQty);
    }
  }

  const allSkus = new Set([...proposedBySku.keys(), ...deliveredBySku.keys()]);

  return Array.from(allSkus).map((sku) => {
    const proposed = proposedBySku.get(sku) || 0;
    const delivered = deliveredBySku.get(sku) || 0;
    const remaining = Math.max(delivered - proposed, 0);

    return {
      itemName: sku,
      proposedQuantity: String(Math.round(proposed)).padStart(2, '0'),
      deliveredQuantity: String(Math.round(delivered)).padStart(2, '0'),
      remainingQuantity: String(Math.round(remaining)).padStart(2, '0'),
    };
  });
}

function buildMaterialSummary(areas, materialDelivery) {
  const issuedBySku = new Map();
  const usedBySku = new Map();

  for (const delivery of materialDelivery || []) {
    const plain = delivery?.toObject ? delivery.toObject() : delivery;
    for (const item of plain.items || []) {
      const sku = (item?.sku ?? '').toString().trim();
      if (!sku) continue;
      const issuedQty = Number(item?.issued_qty ?? item?.issuedQty ?? 0) || 0;
      issuedBySku.set(sku, (issuedBySku.get(sku) || 0) + issuedQty);
    }
  }

  for (const area of areas || []) {
    for (const fixture of area.fixtures || []) {
      const product = fixture.product;
      const sku =
        (product?.sku ?? product?.name ?? fixture.existingFixtureType ?? '')
          .toString()
          .trim();
      if (!sku) continue;

      const installedQty = Number(fixture?.report?.installed_qty ?? 0) || 0;
      usedBySku.set(sku, (usedBySku.get(sku) || 0) + installedQty);
    }
  }

  const allSkus = new Set([...issuedBySku.keys(), ...usedBySku.keys()]);

  return Array.from(allSkus).map((sku) => {
    const issued = issuedBySku.get(sku) || 0;
    const used = usedBySku.get(sku) || 0;
    const remaining = Math.max(issued - used, 0);

    return {
      itemName: sku,
      issuedQuantity: String(Math.round(issued)).padStart(2, '0'),
      usedQuantity: String(Math.round(used)).padStart(2, '0'),
      remainingQuantity: String(Math.round(remaining)).padStart(2, '0'),
      issued_qty: issued,
      used_qty: used,
      remaining_qty: remaining,
    };
  });
}

function parseMaterialDeliveryItems(body) {
  const { items, sku, issued_qty, issuedQty } = body;
  const parsed = tryParseJson(items);

  if (Array.isArray(parsed) && parsed.length) {
    return parsed
      .map((item) => ({
        sku: (item?.sku ?? '').toString().trim(),
        issued_qty: Number(item?.issued_qty ?? item?.issuedQty ?? 0),
      }))
      .filter((item) => item.sku);
  }

  const singleSku = (sku ?? '').toString().trim();
  if (singleSku) {
    return [
      {
        sku: singleSku,
        issued_qty: Number(issued_qty ?? issuedQty ?? 0),
      },
    ];
  }

  return [];
}

function normalizeDeliveryType(value) {
  const normalized = String(value ?? 'delivery').trim().toLowerCase();
  if (!['pickup', 'delivery'].includes(normalized)) {
    return null;
  }
  return normalized;
}

function getReturnItemName(item) {
  return (item?.item_name ?? item?.itemName ?? item?.sku ?? '').toString().trim();
}

function parseMaterialDeliveryReturnItems(body) {
  const { items, item_name, itemName, sku, returned_qty, returnedQty } = body;
  const parsed = tryParseJson(items);

  if (Array.isArray(parsed) && parsed.length) {
    return parsed
      .map((item) => ({
        item_name: getReturnItemName(item),
        returned_qty: Number(item?.returned_qty ?? item?.returnedQty ?? 0),
      }))
      .filter((item) => item.item_name);
  }

  const singleItemName = getReturnItemName({ item_name, itemName, sku });
  if (singleItemName) {
    return [
      {
        item_name: singleItemName,
        returned_qty: Number(returned_qty ?? returnedQty ?? 0),
      },
    ];
  }

  return [];
}

async function formatMaterialDeliveryReturnList(returns) {
  const list = Array.isArray(returns) ? returns : [];
  const itemNames = [
    ...new Set(
      list.flatMap((entry) => {
        const plain = entry?.toObject ? entry.toObject() : entry;
        return (plain.items || []).map((item) => getReturnItemName(item)).filter(Boolean);
      })
    ),
  ];

  const products = itemNames.length
    ? await Product.find({
        $or: [{ sku: { $in: itemNames } }, { name: { $in: itemNames } }],
      })
        .select('name sku')
        .lean()
    : [];
  const productMap = new Map();
  for (const product of products) {
    productMap.set(product.sku, product);
    productMap.set(product.name, product);
  }

  return list.map((entry) => {
    const plain = entry?.toObject ? entry.toObject() : { ...entry };
    return {
      ...plain,
      items: (plain.items || []).map((item) => {
        const itemName = getReturnItemName(item);
        const product = itemName ? productMap.get(itemName) : null;
        return {
          item_name: itemName,
          productName: product?.name || '',
          returned_qty: Number(item.returned_qty) || 0,
        };
      }),
    };
  });
}

async function formatMaterialDeliveryList(deliveries) {
  const list = Array.isArray(deliveries) ? deliveries : [];
  const materialBaseUrl =
    `${process.env.API_BASE_URL || 'https://ramgeneral-api.onrender.com'}/uploads/materials/`;
  const skus = [
    ...new Set(
      list.flatMap((delivery) => {
        const plain = delivery?.toObject ? delivery.toObject() : delivery;
        return (plain.items || [])
          .map((item) => (item.sku ?? '').toString().trim())
          .filter(Boolean);
      })
    ),
  ];

  const products = skus.length
    ? await Product.find({ sku: { $in: skus } }).select('name sku').lean()
    : [];
  const productMap = new Map(products.map((product) => [product.sku, product]));

  return list.map((delivery) => {
    const plain = delivery?.toObject ? delivery.toObject() : { ...delivery };
    return {
      ...plain,
      deliveryStatus: plain.deliveryStatus || 'pending',
      deliveryType: plain.deliveryType || 'delivery',
      images: (plain.images || []).map((img) => {
        const filename = String(img || '').replace(/^\//, '');
        if (!filename) return img;
        if (filename.startsWith('http')) return filename;
        return `${materialBaseUrl}${filename}`;
      }),
      items: (plain.items || []).map((item) => {
        const skuValue = (item.sku ?? '').toString().trim();
        const product = skuValue ? productMap.get(skuValue) : null;
        return {
          sku: skuValue,
          productName: product?.name || '',
          issued_qty: Number(item.issued_qty) || 0,
        };
      }),
    };
  });
}

const flattenPopulatedLead = (leadId, customer) => {
  const lead = leadId && typeof leadId === 'object' ? leadId : null;
  return {
    lead_id: lead?.lead_id || '',
    leadName: lead?.leadName || lead?.name || customer?.name || '',
    dba: lead?.dba || '',
  };
};

const resolveSalesManagerName = (salesUser) => {
  if (!salesUser || typeof salesUser !== 'object') return '';
  const supervisor = salesUser.reportsTo;
  if (!supervisor || typeof supervisor !== 'object') return '';
  if (isSalesManagerRole(supervisor.userRole)) {
    return supervisor.fullName || '';
  }
  return '';
};

const CUSTOMER_STATUSES = [
  'New',
  'in_progress',
  'draft',
  'completed',
  'reopen',
  'pending_edit_approval',
];

const LEAD_CREATE_STATUSES = ['New', 'In Progress', 'Lost Leads', 'Converted To Customer'];

exports.listCustomers = async (req, res) => {
  try {
    const user_id = req.user.id;
    console.log(user_id);
    const { status, salesPerson } = req.query;
    const filter = {};

    // Get user to check role
    const User = require('../models/User');
    const user = await User.findById(user_id);
    if (!user) {
      return res.status(401).json({ message: 'Invalid authenticated user.' });
    }

    // If contractor, show assigned customers; if project manager, show customers with assigned surveys
    if (user.userRole === 'contractor') {
      filter.assignedTo = user_id;
    } else if (user.userRole === 'Project Manager') {
      const assignedCustomerIds = await Customer.distinct('_id', { assignedTo: user_id });
      filter._id = { $in: assignedCustomerIds };
    }

    if (status) {
      filter.status = status;
    }

    if (salesPerson) {
      filter.user_id = salesPerson;
    }

    const customers = await Customer.find(filter)
      .populate('assignToContractor', 'fullName email')
      .sort({ createdAt: -1 });

    const materialBaseUrl = "https://ramgeneral-api.onrender.com/uploads/materials/";

    const customerSummaries = customers.map((customer) => ({
      id: customer._id,
      customerCode: customer.customerCode || '',
      accountNumber: customer.accountNumber,
      name: customer.name,
      company: customer.company,
      mobileNumber: customer.mobileNumber,
      createdDate: customer.createdAt,
      convertedDate: customer.convertedDate,
      contractor: customer.assignToContractor?.fullName || '',
      lastActivity: customer.lastActivity,
      status: customer.status,
      assignedTo: customer.assignedTo,
      material: (customer.material || []).map(m => {
        const materialObj = m.toObject();
        materialObj.images = (materialObj.images || []).map(img => `${materialBaseUrl}${img}`);
        return materialObj;
      })
    }));

    return res.status(200).json({ customers: customerSummaries });
  } catch (error) {
    console.error('List customers error:', error);
    return res.status(500).json({ message: 'Server error listing customers.' });
  }
};

exports.listConvertedCustomers = async (req, res) => {
  try {
    const user_id = req.user.id;
    const { salesPerson, status } = req.query;
    const filter = { leadId: { $ne: null } };

    // Check if user is Admin or Project Manager
    const Admin = require('../models/Admin');
    const User = require('../models/User');

    const admin = await Admin.findById(user_id);
    if (!admin) {
      const user = await User.findById(user_id);
      if (user && user.userRole === 'Project Manager') {
        filter.assignedTo = user_id;
      }
    }

    if (salesPerson) {
      filter.user_id = salesPerson;
    }

    if (status) {
      filter.status = status;
    }

    const customers = await Customer.find(filter)
      .populate('leadId', LEAD_FIELDS_FOR_POPULATE)
      .populate('assignToContractor', 'fullName email')
      .populate({
        path: 'user_id',
        select: 'fullName email userRole',
        populate: { path: 'reportsTo', select: 'fullName userRole' },
      })
      .sort({ convertedDate: -1 });

    const materialBaseUrl = "https://ramgeneral-api.onrender.com/uploads/materials/";

    const customerSummaries = customers.map((customer) => {
      const leadFields = flattenPopulatedLead(customer.leadId, customer);
      return {
        id: customer._id,
        customerCode: customer.customerCode || '',
        leadId: customer.leadId?._id || customer.leadId || null,
        lead_id: leadFields.lead_id,
        leadName: leadFields.leadName,
        dba: leadFields.dba,
        legalName: customer.legalName,
        uploadElectricityBill: normalizeBillFilenames(customer.uploadElectricityBill),
        addresses: customer.addresses,
        contactInfo: customer.contactInfo,
        notes: customer.notes,
        accountNumber: customer.accountNumber,
        name: customer.name,
        company: customer.company,
        email: customer.email,
        mobileNumber: customer.mobileNumber,
        phone: customer.phone || '',
        billDate: customer.billDate || null,
        leadSource: customer.leadSource,
        createdDate: customer.createdAt,
        convertedDate: customer.convertedDate,
        contractor: customer.assignToContractor?.fullName || '',
        status: customer.status,
        lastActivity: customer.lastActivity,
        assignedTo: customer.assignedTo ?? null,
        verifyStatus: customer.verifyStatus,
        confirmDate: customer.confirmDate || null,
        salesPersonName: customer.user_id?.fullName || customer.user_id?.name || '',
        salesManagerName: resolveSalesManagerName(customer.user_id),
        material: (customer.material || []).map(m => {
          const materialObj = m.toObject();
          materialObj.images = (materialObj.images || []).map(img => `${materialBaseUrl}${img}`);
          return materialObj;
        })
      };
    });

    return res.status(200).json({
      message: 'Converted customers retrieved successfully.',
      total: customerSummaries.length,
      customers: customerSummaries,
    });
  } catch (error) {
    console.error('List converted customers error:', error);
    return res.status(500).json({ message: 'Server error retrieving converted customers.' });
  }
};

exports.listInspections = async (req, res) => {
  try {
    // Fetch customers
    const customers = await Customer.find({
      material: { $exists: true, $not: { $size: 0 } },
      installationStatus: 'completed'
    })
      .populate('assignToContractor', 'fullName email')
      .populate('assignedTo', 'fullName email')
      .populate('user_id', 'fullName')
      .sort({ updatedAt: -1 });

    // Get all customer IDs
    const customerIds = customers.map(customer => customer._id);

    // Fetch customer activities
    const activities = await CustomerActivity.find({
      customer_id: { $in: customerIds }
    })
      .populate('user_id', 'fullName email')
      .sort({ createdAt: -1 });

    // Group activities by customer_id
    const activityMap = {};

    activities.forEach(activity => {
      const customerId = activity.customer_id.toString();

      if (!activityMap[customerId]) {
        activityMap[customerId] = [];
      }

      activityMap[customerId].push(activity);
    });

    const materialBaseUrl =
      'https://ramgeneral-api.onrender.com/uploads/materials/';

    const customerList = customers.map(customer => {
      const customerObj = customer.toObject();

      // Add full image URL
      if (customerObj.material) {
        customerObj.material = customerObj.material.map(item => {
          item.images = (item.images || []).map(
            img => `${materialBaseUrl}${img}`
          );

          return item;
        });
      }

      return {
        ...customerObj,
        id: customerObj._id,
        contractorName:
          customer.assignToContractor?.fullName || '',

        // Add activities
        customerActivity:
          activityMap[customerObj._id.toString()] || []
      };
    });

    return res.status(200).json({
      message: 'Inspection list retrieved successfully.',
      total: customerList.length,
      customers: customerList
    });

  } catch (error) {
    console.error('List inspections error:', error);

    return res.status(500).json({
      message: 'Server error retrieving inspection list.'
    });
  }
};

exports.getCustomer = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(404).json({ message: 'Customer not found.' });
    }

    // ✅ Get customer
    const customer = await Customer.findById(id)
    .populate('leadId', LEAD_FIELDS_FOR_POPULATE)
      .populate('assignToContractor', 'fullName email mobileNumber')
      .populate('assignedTo', 'fullName email mobileNumber')
      .populate('user_id', 'fullName name email userRole');

    if (!customer) {
      return res.status(404).json({ message: 'Customer not found.' });
    }

    // ✅ Get all surveys of this customer
    const surveys = await Survey.find({ customer_id: id }).sort({ createdAt: -1 });

    // ✅ Get all activities of this customer
    const activitiesList = await CustomerActivity.find({ customer_id: id })
      .sort({ date: -1 })
      .populate('user_id', 'fullName email');

    const surveyBaseUrl = "https://ramgeneral-api.onrender.com/uploads/surveys/";
    const materialBaseUrl = "https://ramgeneral-api.onrender.com/uploads/materials/";

    const surveysWithFullUrls = await formatSurveysForResponse(surveys, surveyBaseUrl);

    // ✅ Convert material image to full URLs
    const updatedCustomer = stripCustomerLogFields(customer.toObject());
    const leadFields = flattenPopulatedLead(customer.leadId, customer);
    updatedCustomer.dba =
      (customer.dba ?? updatedCustomer.dba ?? '').toString().trim() ||
      (updatedCustomer.company ?? '').toString().trim() ||
      leadFields.dba ||
      '';
    if (updatedCustomer.material && Array.isArray(updatedCustomer.material)) {
      updatedCustomer.material = updatedCustomer.material.map(item => {
        item.images = (item.images || []).map(img => `${materialBaseUrl}${img}`);
        return item;
      });
    }

    if (Array.isArray(updatedCustomer.contactInfo)) {
      updatedCustomer.contactInfo = updatedCustomer.contactInfo.map(formatContactForResponse);
    }
    if (Array.isArray(updatedCustomer.addresses)) {
      updatedCustomer.addresses = updatedCustomer.addresses.map(formatAddressForResponse);
    }
    if (Array.isArray(updatedCustomer.notes)) {
      updatedCustomer.notes = await enrichNotesWithAuthors(updatedCustomer.notes);
    }

    return res.status(200).json({
      customer: updatedCustomer,
      surveys: surveysWithFullUrls,
      materials: updatedCustomer.material || [],
      activities: activitiesList,
    });

  } catch (error) {
    console.error('Get customer error:', error);
    return res.status(500).json({ message: 'Server error fetching customer.' });
  }
};

exports.getCustomerNotes = async (req, res) => {
  try {
    const customerId = req.params.id || req.query.customer_id || req.query.customerId;

    if (!customerId || !mongoose.Types.ObjectId.isValid(customerId)) {
      return res.status(400).json({ message: 'Valid customer id is required.' });
    }

    const customer = await Customer.findById(customerId).select('notes name');
    if (!customer) {
      return res.status(404).json({ message: 'Customer not found.' });
    }

    const notes = (await enrichNotesWithAuthors(customer.notes || [])).sort(
      (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
    );

    return res.status(200).json({
      customerId,
      notes,
      total: notes.length,
    });
  } catch (error) {
    console.error('Get customer notes error:', error);
    return res.status(500).json({ message: 'Server error fetching customer notes.' });
  }
};

exports.addCustomerNote = async (req, res) => {
  try {
    const customerId =
      req.params.id || req.body.customer_id || req.body.customerId || req.body.id;
    const { title, note } = req.body;

    if (!customerId || !mongoose.Types.ObjectId.isValid(customerId)) {
      return res.status(400).json({ message: 'Valid customer_id is required.' });
    }

    const noteText = (note ?? '').toString().trim();
    if (!noteText) {
      return res.status(400).json({ message: 'note is required.' });
    }

    const customer = await Customer.findById(customerId);
    if (!customer) {
      return res.status(404).json({ message: 'Customer not found.' });
    }

    const noteEntry = buildNoteEntry({
      title,
      note: noteText,
      userId: req.user.id,
    });

    customer.notes = [...(customer.notes || []), noteEntry];
    customer.lastActivity = new Date();
    customer.markModified('notes');
    await customer.save();

    await createLog(
      'Customer Note Added',
      req.user.id,
      customer.name || customer.company || 'Customer',
      'Customer',
      customer._id
    );

    const notes = await enrichNotesWithAuthors(customer.notes);

    return res.status(201).json({
      message: 'Customer note added successfully.',
      note: notes[notes.length - 1],
      notes,
    });
  } catch (error) {
    console.error('Add customer note error:', error);
    return res.status(500).json({ message: 'Server error adding customer note.' });
  }
};

exports.getCustomerAddresses = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Valid customer id is required.' });
    }

    const customer = await Customer.findById(id).select('addresses name');
    if (!customer) {
      return res.status(404).json({ message: 'Customer not found.' });
    }

    const addresses = (customer.addresses || []).map(formatAddressForResponse);

    return res.status(200).json({
      customerId: id,
      addresses,
      total: addresses.length,
    });
  } catch (error) {
    console.error('Get customer addresses error:', error);
    return res.status(500).json({ message: 'Server error fetching customer addresses.' });
  }
};

exports.saveCustomerAddresses = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Valid customer id is required.' });
    }

    let incomingAddresses;
    try {
      incomingAddresses = parseAddressInput(req.body);
    } catch (error) {
      if (error.code === 'ADDRESS_ARRAY_NOT_ALLOWED') {
        return res.status(400).json({ message: error.message });
      }
      throw error;
    }

    if (!incomingAddresses || !incomingAddresses.length) {
      return res.status(400).json({
        message:
          'Address data is required. Send a single address object in addresses/address or flat address fields with optional id to update.',
      });
    }

    const customer = await Customer.findById(id);
    if (!customer) {
      return res.status(404).json({ message: 'Customer not found.' });
    }

    let addresses;
    let saved;
    try {
      ({ addresses, saved } = upsertAddresses(customer.addresses, incomingAddresses));
    } catch (error) {
      if (error.code === 'ADDRESS_NOT_FOUND') {
        return res.status(404).json({ message: error.message });
      }
      throw error;
    }

    customer.addresses = addresses;
    customer.lastActivity = new Date();
    customer.markModified('addresses');
    await customer.save();

    const savedAddress = {
      ...formatAddressForResponse(saved[0]),
      action: saved[0].action,
    };
    const statusCode = savedAddress.action === 'created' ? 201 : 200;

    await createLog('Customer Address Saved', req.user.id, customer.name, 'Customer', customer._id);

    return res.status(statusCode).json({
      message:
        savedAddress.action === 'created'
          ? 'Customer address created successfully.'
          : 'Customer address updated successfully.',
      address: savedAddress,
      addresses: customer.addresses.map(formatAddressForResponse),
    });
  } catch (error) {
    console.error('Save customer addresses error:', error);
    return res.status(500).json({ message: 'Server error saving customer addresses.' });
  }
};

exports.getCustomerContacts = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Valid customer id is required.' });
    }

    const customer = await Customer.findById(id).select('contactInfo name');
    if (!customer) {
      return res.status(404).json({ message: 'Customer not found.' });
    }

    const contacts = (customer.contactInfo || []).map(formatContactForResponse);

    return res.status(200).json({
      customerId: id,
      contacts,
      total: contacts.length,
    });
  } catch (error) {
    console.error('Get customer contacts error:', error);
    return res.status(500).json({ message: 'Server error fetching customer contacts.' });
  }
};

exports.saveCustomerContacts = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Valid customer id is required.' });
    }

    let incomingContacts;
    try {
      incomingContacts = parseContactInput(req.body);
    } catch (error) {
      if (error.code === 'CONTACT_ARRAY_NOT_ALLOWED') {
        return res.status(400).json({ message: error.message });
      }
      throw error;
    }

    if (!incomingContacts || !incomingContacts.length) {
      return res.status(400).json({
        message:
          'Contact data is required. Send a single contact object in contactInfo or flat contact fields with optional id to update.',
      });
    }

    const customer = await Customer.findById(id);
    if (!customer) {
      return res.status(404).json({ message: 'Customer not found.' });
    }

    const uploadsByIdx = resolveContactBusinessCardUploads(req);
    const standaloneUploads = resolveStandaloneBusinessCardUploads(req);

    let contactInfo;
    let saved;
    try {
      ({ contactInfo, saved } = upsertContactInfo(
        customer.contactInfo,
        incomingContacts,
        uploadsByIdx,
        standaloneUploads
      ));
    } catch (error) {
      if (error.code === 'CONTACT_NOT_FOUND') {
        return res.status(404).json({ message: error.message });
      }
      throw error;
    }

    customer.contactInfo = contactInfo;
    customer.lastActivity = new Date();
    customer.markModified('contactInfo');
    await customer.save();

    const savedContact = {
      ...formatContactForResponse(saved[0]),
      action: saved[0].action,
    };
    const statusCode = savedContact.action === 'created' ? 201 : 200;

    await createLog('Customer Contact Saved', req.user.id, customer.name, 'Customer', customer._id);

    return res.status(statusCode).json({
      message:
        savedContact.action === 'created'
          ? 'Customer contact created successfully.'
          : 'Customer contact updated successfully.',
      contact: savedContact,
      contactInfo: customer.contactInfo.map(formatContactForResponse),
    });
  } catch (error) {
    console.error('Save customer contacts error:', error);
    return res.status(500).json({ message: 'Server error saving customer contacts.' });
  }
};

exports.updateCustomer = async (req, res) => {
  try {
    const { id } = req.params;
    const body = req.body;

    const customer = await Customer.findById(id);
    if (!customer) {
      return res.status(404).json({ message: 'Customer not found.' });
    }

    const setString = (field) => {
      if (body[field] !== undefined) {
        customer[field] = body[field] === null ? '' : String(body[field]).trim();
      }
    };

    setString('name');
    setString('legalName');
    setString('accountNumber');
    setString('company');
    setString('customerCode');
    if (body.customer_code !== undefined && body.customerCode === undefined) {
      customer.customerCode = body.customer_code === null ? '' : String(body.customer_code).trim();
    }

    if (body.mobileNumber !== undefined) {
      customer.mobileNumber = body.mobileNumber || '';
    }
    if (body.mobile !== undefined) {
      customer.mobileNumber = body.mobile || '';
    }

    if (body.email !== undefined) {
      customer.email = body.email ? String(body.email).trim().toLowerCase() : '';
    }

    if (body.leadSource !== undefined) {
      if (body.leadSource) {
        const leadSourceCode = resolveLeadSourceCode(body.leadSource);
        if (!leadSourceCode) {
          return res.status(400).json({
            message: 'Invalid leadSource. Send a code (e.g. WB) or name (e.g. Website).',
          });
        }
        customer.leadSource = leadSourceCode;
      } else {
        customer.leadSource = '';
      }
    }

    if (body.lastActivity !== undefined) {
      customer.lastActivity = body.lastActivity ? new Date(body.lastActivity) : new Date();
    }

    if (body.address !== undefined) {
      const parsedAddress = tryParseJson(body.address);
      if (typeof parsedAddress === 'object' && parsedAddress !== null) {
        customer.address = {
          street: (parsedAddress.street ?? '').toString().trim(),
          city: (parsedAddress.city ?? '').toString().trim(),
          state: (parsedAddress.state ?? '').toString().trim(),
          zip: (parsedAddress.zip ?? '').toString().trim(),
        };
      }
    }
    if (body.street !== undefined) customer.address.street = body.street || '';
    if (body.city !== undefined) customer.address.city = body.city || '';
    if (body.state !== undefined) customer.address.state = body.state || '';
    if (body.zip !== undefined) customer.address.zip = body.zip || '';

    const hasAddressesField = body.addresses !== undefined || body.address !== undefined;
    const hasContactInfoField = body.contactInfo !== undefined || body.contact_info !== undefined;

    if (hasAddressesField) {
      const processedAddresses = normalizeAddresses(body.addresses ?? body.address);
      if (processedAddresses !== null) {
        customer.addresses = mergeSubdocuments(customer.addresses, processedAddresses);
        customer.markModified('addresses');
      }
    }

    if (hasContactInfoField) {
      const processedContactInfo = normalizeContactInfo(body.contactInfo ?? body.contact_info);
      if (processedContactInfo !== null) {
        customer.contactInfo = mergeSubdocuments(customer.contactInfo, processedContactInfo);
        customer.markModified('contactInfo');
      }
    }

    if (body.notes !== undefined) {
      const processedNotes = attachUserIdToNotes(
        normalizeNotes(body.notes).filter((item) => item.note),
        req.user.id
      );
      if (processedNotes.length > 0) {
        customer.notes = [...(customer.notes || []), ...processedNotes];
        customer.markModified('notes');
      }
    }

    const activityItems = [];
    const parsedActivityLog = tryParseJson(body.activityLog);
    if (Array.isArray(parsedActivityLog)) {
      activityItems.push(...parsedActivityLog);
    } else if (Array.isArray(body.activityLog)) {
      activityItems.push(...body.activityLog);
    } else if (body.activityType) {
      activityItems.push({
        activityType: body.activityType,
        date: body.activityDate,
        outcome: body.outcome,
        notes: body.notes,
        nextFollowUpDate: body.nextFollowUpDate,
        timeSlot: body.timeSlot,
        location: body.location,
        address: body.address,
      });
    }

    if (activityItems.length > 0 && req.user?.id) {
      for (const item of activityItems) {
        if (!item?.activityType) continue;
        await CustomerActivity.create({
          customer_id: id,
          user_id: req.user.id,
          activityType: item.activityType,
          date: item.date ? new Date(item.date) : new Date(),
          timeSlot: item.timeSlot || '',
          location: item.location || '',
          address: item.address || '',
          notes: item.notes || '',
          outcome: item.outcome || '',
          nextFollowUpDate: item.nextFollowUpDate ? new Date(item.nextFollowUpDate) : undefined,
        });
      }
    }

    await syncLeadFieldsFromBody(customer, body);

    const newBillFilenames = resolveNewBillFilenames(
      req,
      body.uploadElectricityBill,
      body.upload_electricity_bill
    );
    if (newBillFilenames.length > 0) {
      const existingBills = normalizeBillFilenames(customer.uploadElectricityBill);
      customer.uploadElectricityBill = [...existingBills, ...newBillFilenames];
      customer.markModified('uploadElectricityBill');
    } else if (body.uploadElectricityBill !== undefined) {
      customer.uploadElectricityBill = normalizeBillFilenames(body.uploadElectricityBill);
      customer.markModified('uploadElectricityBill');
    }

    await customer.save({ validateModifiedOnly: true });

    if (body.surveys !== undefined) {
      await applySurveySiteUpdates(id, body.surveys);
    }

    if (customer.leadId && body.status && LEAD_CREATE_STATUSES.includes(body.status)) {
      await Lead.findByIdAndUpdate(customer.leadId, {
        status: body.status,
        convertedToCustomer: body.status === 'Converted To Customer',
      });
    }

    const updatedSurveys = await Survey.find({ customer_id: id }).sort({ createdAt: -1 });
    const surveyBaseUrl = 'https://ramgeneral-api.onrender.com/uploads/surveys/';
    const billBaseUrl = 'https://ramgeneral-api.onrender.com/uploads/leads/bills/';

    const surveysWithFullUrls = await formatSurveysForResponse(
      updatedSurveys,
      surveyBaseUrl
    );

    const customerResponse = customer.toObject();
    customerResponse.uploadElectricityBill = normalizeBillFilenames(
      customerResponse.uploadElectricityBill
    );
    customerResponse.uploadElectricityBillUrls = customerResponse.uploadElectricityBill.map(
      (filename) => `${billBaseUrl}${filename}`
    );

    await createLog('Customer Updated', req.user.id, customer.name, 'Customer', customer._id);

    return res.status(200).json({
      customer: customerResponse,
      surveys: surveysWithFullUrls,
      message: 'Customer updated successfully.',
    });
  } catch (error) {
    console.error('Update customer error:', error);
    if (error.code === 11000) {
      return res.status(400).json({ message: 'Account number already exists.' });
    }
    return res.status(500).json({ message: 'Server error updating customer.', error: error.message });
  }
};

exports.assignContractor = async (req, res) => {
  try {
    const user_id = req.user.id;
    const surveyId = req.body.survey_id ?? req.body.surveyId;
    const contractorId =
      req.body.contractor ?? req.body.contractorId ?? req.body.assignToContractor;

    if (!surveyId) {
      return res.status(400).json({ message: 'survey_id is required.' });
    }

    if (!contractorId) {
      return res.status(400).json({ message: 'contractor is required.' });
    }

    const contractorUser = await User.findById(contractorId);
    if (!contractorUser) {
      return res.status(404).json({ message: 'Contractor user not found.' });
    }

    const survey = await Survey.findByIdAndUpdate(
      surveyId,
      { assignToContractor: contractorId },
      { new: true, runValidators: true },
      { projectManagerStatus: 'assigned' },
      { installationStatus: 'new' }
    ).populate('assignToContractor', 'fullName email userRole mobileNumber');

    if (!survey) {
      return res.status(404).json({ message: 'Survey not found.' });
    }

    const customer = survey.customer_id
      ? await Customer.findById(survey.customer_id).select('name')
      : null;

    await createLog(
      'Contractor Assigned to Survey',
      user_id,
      customer?.name || survey.surveyName || 'Survey',
      'Survey',
      survey._id
    );

    return res.status(200).json({
      survey,
      message: 'Contractor assigned successfully.',
    });
  } catch (error) {
    console.error('Assign contractor error:', error);
    return res.status(500).json({ message: 'Server error assigning contractor.' });
  }
};

exports.listAssignedCustomers = async (req, res) => {
  try {
    const user_id = req.user.id;
    const { status, salesPerson } = req.query;

    // Get user to check role
    const User = require('../models/User');
    const user = await User.findById(user_id);
    if (!user) {
      return res.status(401).json({ message: 'Invalid authenticated user.' });
    }

    // Only allow contractors and project managers to access this endpoint
    if (user.userRole !== 'contractor' && user.userRole !== 'Project Manager') {
      return res.status(403).json({ message: 'Access denied. Only contractors and project managers can view assigned customers.' });
    }

    const filter = { assignedTo: user_id };

    if (status) {
      filter.status = status;
    }

    if (salesPerson) {
      filter.user_id = salesPerson;
    }

    const customers = await Customer.find(filter)
      .sort({ createdAt: -1 })
      .populate('assignedTo', 'fullName email userRole')
      .populate('user_id', 'fullName email');

    const materialBaseUrl = "https://ramgeneral-api.onrender.com/uploads/materials/";

    const customerSummaries = customers.map((customer) => ({
      id: customer._id,
      accountNumber: customer.accountNumber,
      name: customer.name,
      company: customer.company,
      mobileNumber: customer.mobileNumber,
      email: customer.email,
      leadSource: customer.leadSource,
      createdDate: customer.createdAt,
      convertedDate: customer.convertedDate,
      contractor: customer.assignToContractor?.fullName || '',
      lastActivity: customer.lastActivity,
      status: customer.status,
      assignedTo: customer.assignedTo,
      createdBy: customer.user_id,
      material: (customer.material || []).map(m => {
        const materialObj = m.toObject();
        materialObj.images = (materialObj.images || []).map(img => `${materialBaseUrl}${img}`);
        return materialObj;
      })
    }));

    return res.status(200).json({
      message: 'Assigned customers retrieved successfully.',
      total: customerSummaries.length,
      customers: customerSummaries,
    });
  } catch (error) {
    console.error('List assigned customers error:', error);
    return res.status(500).json({ message: 'Server error listing assigned customers.' });
  }
};

exports.updateCustomerSurveyStatus = async (req, res) => {
  try {
    const { surveyId, status } = req.params;

    // ✅ Validate allowed statuses
    const allowedStatuses = ['in_progress', 'draft', 'completed', 'submitted'];

    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({
        message: `Invalid status. Allowed: ${allowedStatuses.join(', ')}`,
      });
    }

    // ✅ Check survey exists
    const survey = await Survey.findById(surveyId);
    if (!survey) {
      return res.status(404).json({ message: 'Survey not found.' });
    }

    survey.status = status;
    if (status === 'submitted') {
      survey.editApprovalStatus = 'none';
    }
    await survey.save();

    let customer = null;
    if (status === 'submitted' && survey.customer_id) {
      customer = await Customer.findById(survey.customer_id);
      if (customer) {
        customer.status = 'submitted';
        customer.verifyStatus = 'submitted';
        customer.lastActivity = new Date();
        await customer.save();

        await createLog(
          'Survey Submitted',
          req.user.id,
          customer.name,
          'Customer',
          customer._id
        );
      }
    }

    return res.status(200).json({
      message: `Survey status updated to '${status}' successfully.`,
      survey,
      ...(customer && { customer }),
    });

  } catch (error) {
    console.error('Update survey status error:', error);
    return res.status(500).json({
      message: 'Server error updating survey status.',
    });
  }
};

exports.getCustomersByUser = async (req, res) => {
  try {
    const userId = req.user.id;

    if (!userId) {
      return res.status(401).json({
        message: 'User not authenticated.',
      });
    }

    const user = await User.findById(userId).select('userRole fullName email').lean();
    if (!user) {
      return res.status(401).json({ message: 'Invalid authenticated user.' });
    }

    const { salesPersonId, salesPerson } = req.query;
    const filterSalesPersonId = salesPersonId || salesPerson;
    const customerFilter = {};

    if (isSalesManagerRole(user.userRole)) {
      const teamMembers = await User.find({ reportsTo: userId }).select('_id').lean();
      const teamIds = teamMembers.map((member) => member._id);
      const allowedUserIds = [
        new mongoose.Types.ObjectId(userId),
        ...teamIds,
      ];

      if (filterSalesPersonId) {
        if (!mongoose.Types.ObjectId.isValid(filterSalesPersonId)) {
          return res.status(400).json({ message: 'Invalid salesPersonId.' });
        }
        const isAllowed = allowedUserIds.some(
          (id) => id.toString() === filterSalesPersonId.toString()
        );
        if (!isAllowed) {
          return res.status(403).json({ message: 'Sales person is not on your team.' });
        }
        customerFilter.user_id = filterSalesPersonId;
      } else {
        customerFilter.user_id = { $in: allowedUserIds };
      }
    } else {
      customerFilter.user_id = userId;
    }

    const customers = await Customer.find(customerFilter)
      .populate({
        path: 'user_id',
        select: 'fullName email mobileNumber userRole reportsTo',
        populate: { path: 'reportsTo', select: 'fullName email mobileNumber userRole' },
      })
      .populate({
        path: 'leadId',
        select: 'lead_id leadName name status assignedBy assignedAt user_id convertedToCustomer',
        populate: { path: 'assignedBy', select: 'fullName email mobileNumber userRole' },
      })
      .sort({ createdAt: -1 });

    const customerIds = customers.map((customer) => customer._id);
    const surveys = customerIds.length
      ? await Survey.find({ customer_id: { $in: customerIds } })
      : [];

    const activities = customerIds.length
      ? await CustomerActivity.find({ customer_id: { $in: customerIds } })
          .populate('user_id', 'fullName email mobileNumber userRole')
          .sort({ date: -1, createdAt: -1 })
      : [];

    const activityMap = {};
    activities.forEach((activity) => {
      const customerId = activity.customer_id.toString();
      if (!activityMap[customerId]) activityMap[customerId] = [];
      activityMap[customerId].push(activity.toObject ? activity.toObject() : activity);
    });

    const customersWithSurveys = await Promise.all(
      customers.map(async (customer) => {
        const customerObj = customer.toObject();
        const lead =
          customerObj.leadId && typeof customerObj.leadId === 'object' ? customerObj.leadId : null;
        const salesPersonUser = customerObj.user_id;
        const salesManagerFromLead = lead?.assignedBy;
        const salesManagerFromReportsTo =
          salesPersonUser?.reportsTo && typeof salesPersonUser.reportsTo === 'object'
            ? salesPersonUser.reportsTo
            : null;

        const customerSurveys = surveys.filter(
          (survey) => survey.customer_id.toString() === customer._id.toString()
        );
        customerObj.surveys = await attachSurveysWithQuotations(customerSurveys, customerObj);
        customerObj.salesPerson = mapUserSummary(salesPersonUser);
        customerObj.salesPersonName = customerObj.salesPerson?.fullName || '';
        customerObj.salesManager = mapUserSummary(salesManagerFromLead || salesManagerFromReportsTo);
        customerObj.leadAssignment = lead
          ? {
            leadId: lead._id,
            lead_id: lead.lead_id || '',
            leadName: lead.leadName || lead.name || '',
            assignedBy: mapUserSummary(lead.assignedBy),
            assignedAt: lead.assignedAt || null,
            convertedToCustomer: lead.convertedToCustomer ?? true,
          }
          : null;
        customerObj.customerActivity = activityMap[customer._id.toString()] || [];

        stripCustomerQuotationFields(customerObj);

        return customerObj;
      })
    );

    const customersWithNoteAuthors = await enrichNotesForManyRecords(
      customersWithSurveys,
      'notes'
    );

    customersWithNoteAuthors.forEach((customer) => {
      if (Array.isArray(customer.notes)) {
        customer.notes.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      }
    });

    return res.status(200).json({
      customers: customersWithNoteAuthors,
      total: customersWithNoteAuthors.length,
    });
  } catch (error) {
    console.error('Get customers by user error:', error);

    return res.status(500).json({
      message: 'Server error fetching customers by user.',
      error: error.message,
    });
  }
};

exports.getCustomersByContractor = async (req, res) => {
  try {
    const userId = req.user.id;

    if (!userId) {
      return res.status(401).json({
        message: 'User not authenticated.',
      });
    }

    const surveyBaseUrl = 'https://ramgeneral-api.onrender.com/uploads/surveys/';
    const materialBaseUrl = 'https://ramgeneral-api.onrender.com/uploads/materials/';

    const surveys = await Survey.find({ assignToContractor: userId })
      .populate({
        path: 'customer_id',
        select: 'name accountNumber mobileNumber email company dba leadSource createdAt addresses convertedDate assignToContractor contractorStatus projectManagerStatus verifyStatus',
        populate: [
          { path: 'assignToContractor', select: 'fullName email mobileNumber userRole' },
          { path: 'assignedTo', select: 'fullName email mobileNumber userRole' },
          { path: 'leadId', select: 'dba leadName lead_id name' },
          {
            path: 'user_id',
            select: 'fullName name email userRole mobileNumber',
            populate: { path: 'reportsTo', select: 'fullName userRole' },
          },
        ],
      })
      .populate('user_id', 'fullName email name userRole mobileNumber')
      .populate('assignedTo', 'fullName email mobileNumber userRole')
      .populate('assignToContractor', 'fullName email mobileNumber userRole')
      .sort({ createdAt: -1 });

    const formattedSurveys = await formatSurveysForResponse(surveys, surveyBaseUrl);

    const surveysWithDetails = await Promise.all(
      formattedSurveys.map(async (survey, index) => {
        const customerDetails = await formatCustomerForSurveyResponse(
          surveys[index].customer_id,
          materialBaseUrl
        );

        const deliveredMaterial = (surveys[index].materialDelivery || []).filter((delivery) =>
          ['delivered', 'verified'].includes(delivery?.deliveryStatus)
        );

        return {
          ...survey,
          customer_id: customerDetails,
          materialSummary: deliveredMaterial.length
            ? buildMaterialSummary(survey.areas, deliveredMaterial)
            : [],
          materialDelivery: deliveredMaterial.length
            ? await formatMaterialDeliveryList(deliveredMaterial)
            : [],
          materialDeliveryReturn: await formatMaterialDeliveryReturnList(
            surveys[index].materialDeliveryReturn
          ),
          deliverySummary: surveys[index].deliverySummary || [],
        };
      })
    );

    return res.status(200).json({
      total: surveysWithDetails.length,
      surveys: surveysWithDetails,
    });
  } catch (error) {
    console.error('Get customers by contractor error:', error);

    return res.status(500).json({
      message: 'Server error fetching surveys for Contractor.',
      error: error.message,
    });
  }
};

exports.getCustomersByPM = async (req, res) => {
  try {
    const userId = req.user.id;

    if (!userId) {
      return res.status(401).json({
        message: 'User not authenticated.',
      });
    }

    const surveyBaseUrl = 'https://ramgeneral-api.onrender.com/uploads/surveys/';
    const materialBaseUrl = 'https://ramgeneral-api.onrender.com/uploads/materials/';

    const surveys = await Survey.find({ assignedTo: userId })
      .populate({
        path: 'customer_id',
        populate: [
          { path: 'assignToContractor', select: 'fullName email mobileNumber userRole' },
          { path: 'assignedTo', select: 'fullName email mobileNumber userRole' },
          { path: 'leadId', select: 'dba leadName lead_id name' },
          {
            path: 'user_id',
            select: 'fullName name email userRole mobileNumber',
            populate: { path: 'reportsTo', select: 'fullName userRole' },
          },
        ],
      })
      .populate('user_id', 'fullName email name userRole mobileNumber')
      .populate('assignedTo', 'fullName email userRole mobileNumber')
      .populate('assignToContractor', 'fullName email userRole mobileNumber')
      .populate('editApprovalBy', 'fullName email userRole')
      .sort({ createdAt: -1 });

    const formattedSurveys = await formatSurveysForResponse(surveys, surveyBaseUrl);

    const surveysWithDetails = await Promise.all(
      formattedSurveys.map(async (survey, index) => {
        const customerDetails = await formatCustomerForSurveyResponse(
          surveys[index].customer_id,
          materialBaseUrl
        );

        return {
          ...survey,
          customer_id: customerDetails,
          materialSummary: buildMaterialSummaryFromAreas(survey.areas),
          materialDelivery: await formatMaterialDeliveryList(surveys[index].materialDelivery),
          materialDeliveryReturn: await formatMaterialDeliveryReturnList(
            surveys[index].materialDeliveryReturn
          ),
          deliverySummary: buildDeliverySummary(
            survey.areas,
            surveys[index].materialDelivery
          ),
        };
      })
    );

    return res.status(200).json({
      message: 'Surveys retrieved successfully for Project Manager.',
      total: surveysWithDetails.length,
      surveys: surveysWithDetails,
    });
  } catch (error) {
    console.error('Get customers by PM error:', error);
    return res.status(500).json({
      message: 'Server error fetching surveys for Project Manager.',
      error: error.message,
    });
  }
};

exports.addSurveyMaterialDelivery = async (req, res) => {
  try {
    const user_id = req.user.id;
    const surveyId = req.body.survey_id ?? req.body.surveyId;
    const deliveryId = req.body.id ?? req.body._id ?? req.body.material_delivery_id;
    const {
      date,
      delivery_date,
      time,
      time_slot,
      note,
      deliveryStatus,
      delivery_status,
      deliveryType,
      delivery_type,
    } = req.body;

    const Admin = require('../models/Admin');
    const isAdmin = await Admin.findById(user_id);
    let isAuthorized = !!isAdmin;

    if (!isAuthorized) {
      const user = await User.findById(user_id);
      if (user && user.userRole === 'Project Manager') {
        isAuthorized = true;
      }
    }

    if (!isAuthorized) {
      return res.status(403).json({ message: 'Only admins or project managers can schedule material delivery.' });
    }

    if (!surveyId) {
      return res.status(400).json({ message: 'survey_id is required.' });
    }

    const hasItemsInput =
      req.body.items !== undefined || req.body.sku !== undefined;
    const parsedItems = hasItemsInput ? parseMaterialDeliveryItems(req.body) : null;

    if (!deliveryId && (!parsedItems || !parsedItems.length)) {
      return res.status(400).json({ message: 'At least one delivery item with sku is required.' });
    }

    const typeInput = deliveryType ?? delivery_type;
    const normalizedDeliveryType =
      typeInput !== undefined && typeInput !== null && String(typeInput).trim()
        ? normalizeDeliveryType(typeInput)
        : null;

    if (typeInput !== undefined && typeInput !== null && String(typeInput).trim() && !normalizedDeliveryType) {
      return res.status(400).json({ message: "Invalid deliveryType. Allowed: pickup, delivery." });
    }

    const survey = await Survey.findById(surveyId);
    if (!survey) {
      return res.status(404).json({ message: 'Survey not found.' });
    }

    let savedDelivery;
    let action = 'created';

    if (deliveryId) {
      const existingDelivery = survey.materialDelivery.id(deliveryId);
      if (!existingDelivery) {
        return res.status(404).json({ message: 'Material delivery not found.' });
      }

      if (date !== undefined || delivery_date !== undefined) {
        existingDelivery.date = new Date(date || delivery_date);
      }
      if (time !== undefined || time_slot !== undefined) {
        existingDelivery.time = (time ?? time_slot ?? '').toString().trim();
      }
      if (note !== undefined) {
        existingDelivery.note = note.toString().trim();
      }
      if (deliveryStatus !== undefined || delivery_status !== undefined) {
        const status = (deliveryStatus ?? delivery_status).toString().trim().toLowerCase();
        if (['pending', 'scheduled', 'delivered', 'cancelled', 'approved', 'verified'].includes(status)) {
          existingDelivery.deliveryStatus = status;
        }
      }
      if (parsedItems?.length) {
        existingDelivery.items = parsedItems;
      }
      if (normalizedDeliveryType) {
        existingDelivery.deliveryType = normalizedDeliveryType;
      }

      savedDelivery = existingDelivery;
      action = 'updated';
    } else {
      const deliveryEntry = {
        date: date || delivery_date ? new Date(date || delivery_date) : new Date(),
        time: (time ?? time_slot ?? '').toString().trim(),
        deliveryType: normalizedDeliveryType || 'delivery',
        items: parsedItems,
        note: (note ?? '').toString().trim(),
        deliveryStatus: (deliveryStatus ?? delivery_status ?? 'pending').toString().trim().toLowerCase(),
        createdBy: user_id,
        createdAt: new Date(),
      };

      if (!['pending', 'scheduled', 'delivered', 'cancelled', 'approved'].includes(deliveryEntry.deliveryStatus)) {
        deliveryEntry.deliveryStatus = 'pending';
      }

      survey.materialDelivery.push(deliveryEntry);
      savedDelivery = survey.materialDelivery[survey.materialDelivery.length - 1];
    }

    survey.markModified('materialDelivery');
    await survey.save();

    const customer = survey.customer_id
      ? await Customer.findById(survey.customer_id).select('name')
      : null;

    await createLog(
      action === 'updated' ? 'Survey Material Delivery Updated' : 'Survey Material Delivery Scheduled',
      user_id,
      customer?.name || survey.surveyName || 'Survey',
      'Survey',
      survey._id
    );

    const [formattedDelivery] = await formatMaterialDeliveryList([savedDelivery]);

    return res.status(200).json({
      message:
        action === 'updated'
          ? 'Material delivery updated successfully.'
          : 'Material delivery scheduled successfully.',
      survey_id: survey._id,
      materialDelivery: formattedDelivery,
    });
  } catch (error) {
    console.error('Add survey material delivery error:', error);
    return res.status(500).json({ message: 'Server error scheduling material delivery.' });
  }
};

exports.addSurveyMaterialDeliveryReturn = async (req, res) => {
  try {
    const user_id = req.user.id;
    const surveyId = req.body.survey_id ?? req.body.surveyId;
    const returnId =
      req.body.id ?? req.body._id ?? req.body.material_delivery_return_id ?? req.body.return_id;
    const { date, return_date, time, time_slot, note } = req.body;

    const Admin = require('../models/Admin');
    const isAdmin = await Admin.findById(user_id);
    let isAuthorized = !!isAdmin;

    if (!isAuthorized) {
      const user = await User.findById(user_id);
      if (
        user &&
        (user.userRole === 'Project Manager' || user.userRole === 'contractor')
      ) {
        isAuthorized = true;
      }
    }

    if (!isAuthorized) {
      return res.status(403).json({
        message: 'Only admins, project managers, or contractors can add material returns.',
      });
    }

    if (!surveyId) {
      return res.status(400).json({ message: 'survey_id is required.' });
    }

    const hasItemsInput =
      req.body.items !== undefined ||
      req.body.item_name !== undefined ||
      req.body.itemName !== undefined ||
      req.body.sku !== undefined;
    const parsedItems = hasItemsInput ? parseMaterialDeliveryReturnItems(req.body) : null;

    if (!returnId && (!parsedItems || !parsedItems.length)) {
      return res.status(400).json({
        message: 'At least one return item with item_name is required.',
      });
    }

    const survey = await Survey.findById(surveyId);
    if (!survey) {
      return res.status(404).json({ message: 'Survey not found.' });
    }

    if (!isAdmin) {
      const user = await User.findById(user_id).select('userRole');
      const isContractor = user?.userRole === 'contractor';
      const isPm = user?.userRole === 'Project Manager';

      if (
        isContractor &&
        survey.assignToContractor?.toString() !== user_id.toString()
      ) {
        return res.status(403).json({
          message: 'You are not assigned as contractor for this survey.',
        });
      }

      if (isPm && survey.assignedTo?.toString() !== user_id.toString()) {
        return res.status(403).json({
          message: 'You are not assigned as project manager for this survey.',
        });
      }
    }

    let savedReturn;
    let action = 'created';

    if (returnId) {
      const existingReturn = survey.materialDeliveryReturn.id(returnId);
      if (!existingReturn) {
        return res.status(404).json({ message: 'Material delivery return not found.' });
      }

      if (date !== undefined || return_date !== undefined) {
        existingReturn.date = new Date(date || return_date);
      }
      if (time !== undefined || time_slot !== undefined) {
        existingReturn.time = (time ?? time_slot ?? '').toString().trim();
      }
      if (note !== undefined) {
        existingReturn.note = note.toString().trim();
      }
      if (parsedItems?.length) {
        existingReturn.items = parsedItems;
      }

      savedReturn = existingReturn;
      action = 'updated';
    } else {
      const returnEntry = {
        date: date || return_date ? new Date(date || return_date) : new Date(),
        time: (time ?? time_slot ?? '').toString().trim(),
        items: parsedItems,
        note: (note ?? '').toString().trim(),
        createdBy: user_id,
        createdAt: new Date(),
      };

      survey.materialDeliveryReturn.push(returnEntry);
      savedReturn = survey.materialDeliveryReturn[survey.materialDeliveryReturn.length - 1];
    }

    survey.markModified('materialDeliveryReturn');
    await survey.save();

    const customer = survey.customer_id
      ? await Customer.findById(survey.customer_id).select('name')
      : null;

    await createLog(
      action === 'updated'
        ? 'Survey Material Delivery Return Updated'
        : 'Survey Material Delivery Return Added',
      user_id,
      customer?.name || survey.surveyName || 'Survey',
      'Survey',
      survey._id
    );

    const [formattedReturn] = await formatMaterialDeliveryReturnList([savedReturn]);

    return res.status(200).json({
      message:
        action === 'updated'
          ? 'Material delivery return updated successfully.'
          : 'Material delivery return added successfully.',
      survey_id: survey._id,
      materialDeliveryReturn: formattedReturn,
    });
  } catch (error) {
    console.error('Add survey material delivery return error:', error);
    return res.status(500).json({ message: 'Server error adding material delivery return.' });
  }
};

function setDeliveryCurrentTimestamp(delivery) {
  const now = new Date();
  delivery.date = now;
  delivery.time = now.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  });
}

exports.markDeliveryAsCompleted = async (req, res) => {
  try {
    const user_id = req.user.id;
    const deliveryId =
      req.body.delivery_id ?? req.body.deliveryId ?? req.body.id ?? req.body._id;

    const Admin = require('../models/Admin');
    const isAdmin = await Admin.findById(user_id);
    let isAuthorized = !!isAdmin;

    if (!isAuthorized) {
      const user = await User.findById(user_id);
      if (user && user.userRole === 'Project Manager') {
        isAuthorized = true;
      }
    }

    if (!isAuthorized) {
      return res.status(403).json({ message: 'Only admins or project managers can approve delivery.' });
    }

    if (!deliveryId) {
      return res.status(400).json({ message: 'delivery_id is required.' });
    }

    const survey = await Survey.findOne({ 'materialDelivery._id': deliveryId });

    if (!survey) {
      return res.status(404).json({ message: 'Material delivery not found.' });
    }

    const delivery = survey.materialDelivery.id(deliveryId);
    if (!delivery) {
      return res.status(404).json({ message: 'Material delivery not found.' });
    }

    if (delivery.deliveryStatus === 'delivered') {
      return res.status(400).json({ message: 'Delivery is already delivered.' });
    }

    const uploadedImages = (req.files || []).map((file) => file.filename);
    if (uploadedImages.length) {
      delivery.images = [...(delivery.images || []), ...uploadedImages];
    }

    setDeliveryCurrentTimestamp(delivery);
    delivery.deliveryStatus = 'delivered';
    survey.markModified('materialDelivery');
    await survey.save();

    const customer = survey.customer_id
      ? await Customer.findById(survey.customer_id).select('name')
      : null;

    await createLog(
      'Survey Material Delivery delivered',
      user_id,
      customer?.name || survey.surveyName || 'Survey',
      'Survey',
      survey._id
    );

    const [formattedDelivery] = await formatMaterialDeliveryList([delivery]);

    return res.status(200).json({
      message: 'Delivery marked as approved successfully.',
      survey_id: survey._id,
      materialDelivery: formattedDelivery,
    });
  } catch (error) {
    console.error('Mark delivery as completed error:', error);
    return res.status(500).json({ message: 'Server error approving delivery.' });
  }
};

exports.markDeliveryAsDelivered = async (req, res) => {
  try {
    const user_id = req.user.id;
    const deliveryId =
      req.body.delivery_id ?? req.body.deliveryId ?? req.body.id ?? req.body._id;

    const Admin = require('../models/Admin');
    const isAdmin = await Admin.findById(user_id);
    let isAuthorized = !!isAdmin;

    if (!isAuthorized) {
      const user = await User.findById(user_id);
      if (
        user &&
        (user.userRole === 'Project Manager' || user.userRole === 'contractor')
      ) {
        isAuthorized = true;
      }
    }

    if (!deliveryId) {
      return res.status(400).json({ message: 'delivery_id is required.' });
    }

    const survey = await Survey.findOne({ 'materialDelivery._id': deliveryId });
    if (!survey) {
      return res.status(404).json({ message: 'Material delivery not found.' });
    }

    const delivery = survey.materialDelivery.id(deliveryId);
    if (!delivery) {
      return res.status(404).json({ message: 'Material delivery not found.' });
    }

    if (delivery.deliveryStatus === 'verified') {
      return res.status(400).json({ message: 'Delivery is already marked as verified.' });
    }

    delivery.deliveryStatus = 'verified';
    survey.markModified('materialDelivery');
    survey.markModified('installationStatus');
    survey.installationStatus = 'in_progress';
    await survey.save();

    const customer = survey.customer_id
      ? await Customer.findById(survey.customer_id).select('name')
      : null;

    await createLog(
      'Survey Material Delivery Delivered',
      user_id,
      customer?.name || survey.surveyName || 'Survey',
      'Survey',
      survey._id
    );

    const [formattedDelivery] = await formatMaterialDeliveryList([delivery]);

    return res.status(200).json({
      message: 'verify delivery successfully.',
      survey_id: survey._id,
      materialDelivery: formattedDelivery,
    });
  } catch (error) {
    console.error('Mark delivery as delivered error:', error);
    return res.status(500).json({ message: 'Server error marking delivery as delivered.' });
  }
};

exports.assignToContractor = async (req, res) => {
  try {
    const user_id = req.user.id;

    // Check if user is Admin or Project Manager
    const Admin = require('../models/Admin');
    const isAdmin = await Admin.findById(user_id);
    let isAuthorized = !!isAdmin;

    if (!isAuthorized) {
      const User = require('../models/User');
      const user = await User.findById(user_id);
      if (user && user.userRole === 'Project Manager') {
        isAuthorized = true;
      }
    }

    if (!isAuthorized) {
      return res.status(403).json({ message: 'Only admins or project managers can assign contractors.' });
    }

    const { id } = req.params;
    const { contractorId } = req.body;

    if (!contractorId) {
      return res.status(400).json({ message: 'contractorId is required.' });
    }

    // Verify user exists and is a contractor
    const User = require('../models/User');
    const contractorUser = await User.findById(contractorId);

    if (!contractorUser) {
      return res.status(404).json({ message: 'Contractor user not found.' });
    }

    if (contractorUser.userRole !== 'contractor') {
      return res.status(400).json({ message: 'Assigned user must have the role of contractor.' });
    }

    const customer = await Customer.findByIdAndUpdate(
      id,
      {
        assignToContractor: contractorId,
        contractorStatus: 'New',
      },
      { new: true, runValidators: true }
    ).populate('assignToContractor', 'fullName email userRole');

    if (!customer) {
      return res.status(404).json({ message: 'Customer not found.' });
    }

    await createLog('Contractor Assigned to Customer', user_id, customer.name, 'Assignment', customer._id);

    return res.status(200).json({
      message: 'Customer assigned to contractor successfully.',
      customer
    });
  } catch (error) {
    console.error('Assign to contractor error:', error);
    return res.status(500).json({ message: 'Server error assigning to contractor.' });
  }
};

exports.reassignSalesPerson = async (req, res) => {
  try {
    const userId = req.user.id; // actor
    const { sales_person_user_id, customerId } = req.body;

    if (!sales_person_user_id) {
      return res.status(400).json({ message: 'sales_person_user_id is required.' });
    }

    if (!customerId) {
      return res.status(400).json({ message: 'customerId is required.' });
    }

    const User = require('../models/User');
    const newSalesUser = await User.findById(sales_person_user_id);
    if (!newSalesUser) {
      return res.status(404).json({ message: 'Sales person user not found.' });
    }

    // Find the single customer
    const customer = await Customer.findById(customerId);
    if (!customer) {
      return res.status(404).json({ message: 'Customer not found.' });
    }

    // Update fields
    customer.user_id = sales_person_user_id;
    customer.status = 'New';
    customer.lastActivity = new Date();

    await customer.save();

    await createLog('Salesperson Reassigned', userId, `Reassigned to ${newSalesUser.fullName}`, 'Customer Reassign', customer._id);

    return res.status(200).json({ message: 'Customer reassigned successfully.', customer });
  } catch (error) {
    console.error('Reassign sales person error:', error);
    return res.status(500).json({ message: 'Server error reassigning sales person.' });
  }
};

exports.verifyCustomer = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body; // 'verified' or 'pending'

    if (!['verified', 'completed', 'pending', 'submitted'].includes(status)) {
      return res.status(400).json({ message: "Invalid status. Use 'verified' or 'pending'." });
    }

    const user_id = req.user.id;

    // Check if user is Admin
    const Admin = require('../models/Admin');
    const isAdmin = await Admin.findById(user_id);

    if (!isAdmin) {
      // Check if user is Project Manager
      const User = require('../models/User');
      const user = await User.findById(user_id);
      if (!user || user.userRole !== 'Project Manager') {
        return res.status(403).json({ message: 'Only Admins or Project Managers can verify customers.' });
      }
    }

    let customer = await Customer.findById(id);

    if (!customer) {
      return res.status(404).json({ message: 'Customer not found.' });
    }

    customer.verifyStatus = status;
    customer.status = 'completed';

    if (status === 'verified') {
      const verifiedAt = new Date();
      customer.confirmDate = verifiedAt;

      await Survey.updateMany(
        { customer_id: customer._id },
        { $set: { confirmDate: verifiedAt } }
      );

      customer = await syncPayablesForCustomer(customer);
    }

    await customer.save();

    const { createLog } = require('../utils/logger');
    await createLog(`Customer Survey ${status}`, user_id, customer.name, 'Customer', customer._id);

    return res.status(200).json({
      message: `Customer survey ${status} successfully.`,
      customer,
    });
  } catch (error) {
    console.error('Verify customer error:', error,);
    return res.status(500).json({ message: 'Server error verifying customer.', error: error.message });
  }
};

exports.addCustomerActivity = async (req, res) => {
  try {
    const { id: customer_id } = req.params;
    const user_id = req.user.id;
    const { activityType, date, timeSlot, location, address, notes, outcome, nextFollowUpDate } = req.body;

    if (!activityType) {
      return res.status(400).json({ message: 'activityType is required.' });
    }

    const customer = await Customer.findById(customer_id);
    if (!customer) {
      return res.status(404).json({ message: 'Customer not found.' });
    }

    const activity = await CustomerActivity.create({
      customer_id,
      user_id,
      activityType,
      date: date || Date.now(),
      timeSlot: timeSlot || '',
      location: location || '',
      address: address || '',
      notes: notes || '',
      outcome: outcome || '',
      nextFollowUpDate,
    });

    // Log the activity in the general activity log
    await createLog(`Activity Recorded: ${activityType}`, user_id, customer.name, 'Customer', customer._id);

    return res.status(201).json({
      message: 'Activity recorded successfully.',
      activity,
    });
  } catch (error) {
    console.error('Add customer activity error:', error);
    return res.status(500).json({ message: 'Server error recording activity.' });
  }
};

exports.getCustomerActivities = async (req, res) => {
  try {
    const { id: customer_id } = req.params;

    const activities = await CustomerActivity.find({ customer_id })
      .sort({ date: -1 })
      .populate('user_id', 'fullName email');

    return res.status(200).json({
      activities,
    });
  } catch (error) {
    console.error('Get customer activities error:', error);
    return res.status(500).json({ message: 'Server error fetching activities.' });
  }
};

exports.getCustomerPayableDetails = async (req, res) => {
  try {
    const { id } = req.params;
    const { surveyId, for: payableFor } = req.query;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(404).json({ message: 'Customer not found.' });
    }

    const customer = await Customer.findById(id).populate('leadId', LEAD_FIELDS_FOR_POPULATE);
    if (!customer) {
      return res.status(404).json({ message: 'Customer not found.' });
    }

    let survey = null;
    if (surveyId && mongoose.Types.ObjectId.isValid(surveyId)) {
      survey = await Survey.findOne({
        _id: surveyId,
        customer_id: id,
        quotationStatus: 'approved',
      });
    }
    if (!survey) {
      survey = await Survey.findOne({
        customer_id: id,
        quotationStatus: 'approved',
      }).sort({ quotationApprovedAt: -1, createdAt: -1 });
    }

    if (!survey) {
      return res.status(404).json({ message: 'No quotation-approved survey found for this customer.' });
    }

    const type = normalizePayableFor(payableFor);
    const before = JSON.stringify(customer.commissions || []);
    await syncPayablesForCustomer(customer);
    if (before !== JSON.stringify(customer.commissions || [])) {
      await customer.save();
    }

    const leadFields = flattenPopulatedLead(customer.leadId, customer);
    let payables = null;
    let dynamicCommission = 0;
    let quotationNumber = '';
    let quotationAmount = 0;

    if (survey) {
      payables = await calculateSurveyPayables(survey, customer);
      dynamicCommission = resolvePayableAmount(payables, type);
      quotationNumber = payables.quotationNumber || '';
      quotationAmount = payables.quotationAmount || 0;
    }

    const record = survey ? findCommissionRecord(customer, survey._id, type) : null;
    const totals = survey
      ? getPaymentTotals(customer, survey, type, dynamicCommission)
      : { amount: 0, eligible: 0, paid: 0, pending: 0, locked: 0, balance: 0 };
    const milestones = survey
      ? getCommissionMilestones(type, dynamicCommission, customer, survey)
      : { projectApproved: false, invoiceFullyPaid: false, schedule: [] };

    return res.status(200).json({
      message: 'Payable details retrieved successfully.',
      details: {
        customerId: customer._id,
        surveyId: survey?._id || null,
        commissionId: record?._id || null,
        legalName: customer.legalName || customer.name || '',
        commission: totals.amount,
        eligible: totals.eligible,
        paid: totals.paid,
        pending: totals.pending,
        locked: totals.locked,
        balance: totals.balance,
        milestones,
        leadId: leadFields.lead_id || '',
        leadSource: customer.leadSource || '',
        quotationNumber: quotationNumber || '—',
        quotationAmount,
        payments: (record?.payments || []).map((payment) =>
          payment?.toObject ? payment.toObject() : payment
        ),
      },
    });
  } catch (error) {
    console.error('Get customer payable details error:', error);
    return res.status(500).json({ message: 'Server error retrieving payable details.' });
  }
};

exports.addCommissionPayment = async (req, res) => {
  try {
    const { id } = req.params;
    const { surveyId, for: payableFor, amount, paymentMethod, paymentDate, note } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(404).json({ message: 'Customer not found.' });
    }
    if (!surveyId || !mongoose.Types.ObjectId.isValid(surveyId)) {
      return res.status(400).json({ message: 'Valid surveyId is required.' });
    }

    const customer = await Customer.findById(id);
    if (!customer) {
      return res.status(404).json({ message: 'Customer not found.' });
    }

    const result = await addPaymentToCommission(customer, {
      surveyId,
      payableFor,
      amount,
      paymentMethod,
      paymentDate,
      note,
    });

    await customer.save();
    await createLog('Commission Payment Added', req.user.id, customer.name, 'Customer', customer._id);

    return res.status(200).json({
      message: 'Commission payment added successfully.',
      details: {
        customerId: customer._id,
        surveyId,
        commission: result.dynamicAmount,
        eligible: result.eligible,
        paid: result.paid,
        pending: result.pending,
        locked: result.locked,
        balance: result.balance,
        milestones: result.milestones,
        quotationNumber: result.quotationNumber || '—',
        quotationAmount: result.quotationAmount || 0,
        payments: (result.commission.payments || []).map((payment) =>
          payment?.toObject ? payment.toObject() : payment
        ),
      },
    });
  } catch (error) {
    console.error('Add commission payment error:', error);
    const statusCode = error.statusCode || 500;
    return res.status(statusCode).json({
      message: error.message || 'Server error adding commission payment.',
    });
  }
};

exports.updateCustomerCommissions = async (req, res) => {
  try {
    const { id } = req.params;
    const { commissions } = req.body;

    if (!Array.isArray(commissions)) {
      return res.status(400).json({ message: 'commissions must be an array.' });
    }

    const customer = await Customer.findById(id);
    if (!customer) {
      return res.status(404).json({ message: 'Customer not found.' });
    }

    const newCommissions = commissions.map(comm => {
      const formattedComm = {
        commissionType: comm.commission_type || comm.commissionType,
        amount: comm.amount || 0,
        paidAmount: comm.paid_amount || comm.paidAmount || 0,
        paymentMethod: comm.payment_method || comm.paymentMethod,
        paymentDate: comm.payment_date || comm.paymentDate,
        paymentStatus: comm.payment_status || comm.paymentStatus || 'payment pending',
      };

      if (comm.survey_id || comm.surveyId) {
        formattedComm.surveyId = comm.survey_id || comm.surveyId;
      }

      if (formattedComm.commissionType === 'Survey') {
        formattedComm.salesPerson = comm.sales_person || comm.salesPerson;
      } else if (formattedComm.commissionType === 'Sales Manager') {
        formattedComm.salesManager = comm.sales_manager || comm.salesManager;
      } else if (formattedComm.commissionType === 'Installation') {
        formattedComm.contractor = comm.contractor_id || comm.contractor;
      } else if (formattedComm.commissionType === 'Other') {
        formattedComm.otherName = comm.other_name || comm.otherName;
      }

      return formattedComm;
    });

    customer.commissions = [...customer.commissions, ...newCommissions];
    await customer.save();

    await createLog('Commissions Updated', req.user.id, customer.name, 'Customer', customer._id);

    return res.status(200).json({
      message: 'Commissions updated successfully.',
      customer,
    });
  } catch (error) {
    console.error('Update commissions error:', error);
    return res.status(500).json({ message: 'Server error updating commissions.' });
  }
};

exports.customerCommissionList = async (req, res) => {
  try {
    const approvedSurveys = await Survey.find({ quotationStatus: 'approved' })
      .populate('assignedTo', 'fullName email userRole')
      .populate('assignToContractor', 'fullName email userRole')
      .populate('user_id', 'fullName email name')
      .sort({
        quotationApprovedAt: -1,
        createdAt: -1,
      });

    const customerIdSet = new Set(
      approvedSurveys
        .map((survey) => survey.customer_id?.toString())
        .filter(Boolean)
    );

    if (!customerIdSet.size) {
      return res.status(200).json({
        message: 'Quotation-approved payables retrieved successfully.',
        salesPersons: [],
        salesManagers: [],
        contractors: [],
        overallSummary: {
          salesPersons: { totalCommission: 0, totalPaid: 0, totalPending: 0 },
          salesManagers: { totalCommission: 0, totalPaid: 0, totalPending: 0 },
          contractors: { totalCommission: 0, totalPaid: 0, totalPending: 0 },
        },
      });
    }

    const customers = await Customer.find({ _id: { $in: [...customerIdSet] } })
      .populate('assignToContractor', 'fullName email')
      .populate({
        path: 'user_id',
        select: 'fullName email name userRole',
        populate: { path: 'reportsTo', select: 'fullName email userRole' },
      })
      .populate({
        path: 'leadId',
        select: 'dba leadName assignedBy',
        populate: { path: 'assignedBy', select: 'fullName email userRole' },
      })
      .sort({ createdAt: -1 });

    for (const customer of customers) {
      const before = JSON.stringify(customer.commissions || []);
      await syncPayablesForCustomer(customer);
      const after = JSON.stringify(customer.commissions || []);
      if (before !== after) {
        await customer.save();
      }
    }

    const surveysByCustomer = new Map();

    for (const survey of approvedSurveys) {
      const key = survey.customer_id?.toString();
      if (!key) continue;
      if (!surveysByCustomer.has(key)) surveysByCustomer.set(key, []);
      surveysByCustomer.get(key).push(survey);
    }

    const salesPersons = [];
    const salesManagers = [];
    const contractors = [];

    let salesTotalCommission = 0;
    let salesTotalPaid = 0;
    let salesTotalPending = 0;
    let managerTotalCommission = 0;
    let managerTotalPaid = 0;
    let managerTotalPending = 0;
    let contractorTotalCommission = 0;
    let contractorTotalPaid = 0;
    let contractorTotalPending = 0;

    for (const customer of customers) {
      const customerKey = customer._id.toString();
      const customerSurveys = surveysByCustomer.get(customerKey) || [];
      const legalName = customer.legalName || customer.name || '';
      const dba = customer.company || customer.leadId?.dba || '';
      const installDate = getInstallDate(customer);

      for (const survey of customerSurveys) {
        const payables = await calculateSurveyPayables(survey, customer);
        const surveyId = survey._id.toString();
        const jobNo = survey.job_id || '—';
        const salesPersonName = resolveSurveySalesPersonName(survey, customer);
        const salesManagerName = resolveSurveySalesManagerName(survey, customer);
        const contractorName = resolveSurveyContractorName(survey, customer);

        const salesPayments = getPaymentTotals(
          customer,
          survey,
          'Survey',
          payables.salesCommission
        );
        const managerPayments = getPaymentTotals(
          customer,
          survey,
          'Sales Manager',
          payables.managerCommission
        );
        const contractorPayments = getPaymentTotals(
          customer,
          survey,
          'Installation',
          payables.contractorCommission
        );

        salesPersons.push({
          id: `${customerKey}-${surveyId}`,
          customerId: customerKey,
          surveyId,
          legalName,
          salesPerson: salesPersonName,
          surveyName: payables.surveyName,
          surveyDate: survey.surveyDate || survey.createdAt,
          quotationNumber: payables.quotationNumber || '—',
          confirmed: payables.confirmedDate || '',
          quotationAmount: payables.quotationAmount,
          commission: salesPayments.amount,
          paid: salesPayments.paid,
          pending: salesPayments.pending,
        });

        salesTotalCommission += salesPayments.amount;
        salesTotalPaid += salesPayments.paid;
        salesTotalPending += salesPayments.pending;

        salesManagers.push({
          id: `${customerKey}-${surveyId}-manager`,
          customerId: customerKey,
          surveyId,
          legalName,
          salesManager: salesManagerName,
          surveyName: payables.surveyName,
          surveyDate: survey.surveyDate || survey.createdAt,
          quotationNumber: payables.quotationNumber || '—',
          confirmed: payables.confirmedDate || '',
          quotationAmount: payables.quotationAmount,
          commission: managerPayments.amount,
          paid: managerPayments.paid,
          pending: managerPayments.pending,
        });

        managerTotalCommission += managerPayments.amount;
        managerTotalPaid += managerPayments.paid;
        managerTotalPending += managerPayments.pending;

        contractors.push({
          id: `${customerKey}-${surveyId}`,
          customerId: customerKey,
          surveyId,
          legalName,
          dba,
          contractor: contractorName,
          jobNo,
          surveyName: payables.surveyName,
          installDate: installDate || '',
          totalCharges: payables.quotationAmount,
          commission: contractorPayments.amount,
          paid: contractorPayments.paid,
          pending: contractorPayments.pending,
        });

        contractorTotalCommission += contractorPayments.amount;
        contractorTotalPaid += contractorPayments.paid;
        contractorTotalPending += contractorPayments.pending;
      }
    }

    return res.status(200).json({
      message: 'Quotation-approved payables retrieved successfully.',
      salesPersons,
      salesManagers,
      contractors,
      overallSummary: {
        salesPersons: {
          totalCommission: salesTotalCommission,
          totalPaid: salesTotalPaid,
          totalPending: salesTotalPending,
        },
        salesManagers: {
          totalCommission: managerTotalCommission,
          totalPaid: managerTotalPaid,
          totalPending: managerTotalPending,
        },
        contractors: {
          totalCommission: contractorTotalCommission,
          totalPaid: contractorTotalPaid,
          totalPending: contractorTotalPending,
        },
      },
    });
  } catch (error) {
    console.error('Customer commission list error:', error);
    return res.status(500).json({
      message: 'Server error retrieving customer payables.',
    });
  }
};

exports.updateSurveyEditStatus = async (req, res) => {
  try {
    const surveyId = req.body.survey_id ?? req.body.surveyId;
    const status = String(req.body.status || '').trim().toLowerCase();

    if (!surveyId) {
      return res.status(400).json({ message: 'survey_id is required.' });
    }

    const allowedStatuses = ['pending', 'approved', 'rejected'];
    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({
        message: `Invalid status. Allowed: ${allowedStatuses.join(', ')}`,
      });
    }

    const user_id = req.user.id;

    const survey = await Survey.findById(surveyId);
    if (!survey) {
      return res.status(404).json({ message: 'Survey not found.' });
    }

    survey.editApprovalStatus = status;
    survey.editApprovalBy = user_id;
    survey.editApprovalAt = new Date();

    if (status === 'approved') {
      survey.status = 'reopen';
    }

    await survey.save();

    const customer = survey.customer_id
      ? await Customer.findById(survey.customer_id).select('name')
      : null;

    await createLog(
      `Survey Edit ${status}`,
      user_id,
      customer?.name || survey.surveyName || 'Survey',
      'Survey',
      survey._id
    );

    return res.status(200).json({
      message: `Survey edit status updated to '${status}' successfully.`,
      survey,
    });
  } catch (error) {
    console.error('Update survey edit status error:', error);
    return res.status(500).json({ message: 'Server error updating survey edit status.' });
  }
};

exports.adminApprovalStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body; // 'Approved' or 'Rejected'

    if (!['Approved', 'Rejected'].includes(status)) {
      return res.status(400).json({ message: "Invalid status. Use 'Approved' or 'Rejected'." });
    }

    const user_id = req.user.id;

    // Check if user is Admin
    const Admin = require('../models/Admin');
    const isAdmin = await Admin.findById(user_id);

    if (!isAdmin) {
      const user = await User.findById(user_id);
      const canApprove =
        user &&
        (user.userRole === 'Project Manager' || isSalesManagerRole(user.userRole));
      if (!canApprove) {
        return res.status(403).json({
          message: 'Only Admins, Project Managers, or Sales Managers can approve or reject.',
        });
      }
    }

    const updatePayload = { adminApproval: status };
    if (status === 'Approved') {
      updatePayload.status = 'reopen';
    }

    const customer = await Customer.findByIdAndUpdate(
      id,
      updatePayload,
      { new: true, runValidators: true }
    );

    if (!customer) {
      return res.status(404).json({ message: 'Customer not found.' });
    }

    const { createLog } = require('../utils/logger');
    await createLog(`Customer Admin Approval ${status}`, user_id, customer.name, 'Customer', customer._id);

    return res.status(200).json({
      message: `Customer admin approval ${status} successfully.`,
      customer,
    });
  } catch (error) {
    console.error('Admin approval error:', error);
    return res.status(500).json({ message: 'Server error updating admin approval.' });
  }
};

exports.installationListByUser = async (req, res) => {
  try {
    const userId = req.user.id;
    const materialBaseUrl = "https://ramgeneral-api.onrender.com/uploads/materials/";
    const surveyBaseUrl = "https://ramgeneral-api.onrender.com/uploads/surveys/";

    // Fetch assigned customers only
    const assigned = await Customer.find({ assignToContractor: userId })
      .populate('assignToContractor', 'fullName email mobileNumber')
      .populate('assignedTo', 'fullName email mobileNumber')
      .populate('user_id', 'fullName name email')
      .sort({ createdAt: -1 });

    // Fetch surveys for assigned customers and group by customer_id
    const customerIds = assigned.map(c => c._id);
    const surveys = await Survey.find({ customer_id: { $in: customerIds } }).sort({ createdAt: -1 });

    const surveyMap = {};
    surveys.forEach(s => {
      const cid = s.customer_id?.toString();
      if (!cid) return;
      if (!surveyMap[cid]) surveyMap[cid] = [];
      const sObj = s.toObject();
      sObj.images = (sObj.images || []).map(img => `${surveyBaseUrl}${img}`);
      surveyMap[cid].push(sObj);
    });

    const mapCustomer = (customer) => {
      const obj = customer.toObject();
      if (obj.material) {
        obj.material = obj.material.map(item => {
          item.images = (item.images || []).map(img => `${materialBaseUrl}${img}`);
          return item;
        });
      }
      obj.surveys = surveyMap[customer._id.toString()] || [];
      return obj;
    };

    return res.status(200).json({
      message: 'Installation list retrieved successfully.',
      assigned: {
        total: assigned.length,
        customers: assigned.map(mapCustomer),
      },
    });
  } catch (error) {
    console.error('Installation list by user error:', error);
    return res.status(500).json({ message: 'Server error fetching installation list.' });
  }
};

exports.inspectionListByUser = async (req, res) => {
  try {
    const userId = req.user.id;

    const surveyBaseUrl = 'https://ramgeneral-api.onrender.com/uploads/surveys/';
    const materialBaseUrl = 'https://ramgeneral-api.onrender.com/uploads/materials/';

    const surveys = await Survey.find({
      assignedTo: userId,
      installationStatus: 'submitted',
    })
      .populate({
        path: 'customer_id',
        select:
          'name accountNumber mobileNumber email company dba leadSource createdAt addresses convertedDate assignToContractor contractorStatus projectManagerStatus verifyStatus',
        populate: [
          { path: 'assignToContractor', select: 'fullName email mobileNumber userRole' },
          { path: 'assignedTo', select: 'fullName email mobileNumber userRole' },
          { path: 'leadId', select: 'dba leadName lead_id name' },
          {
            path: 'user_id',
            select: 'fullName name email userRole mobileNumber',
            populate: { path: 'reportsTo', select: 'fullName userRole' },
          },
        ],
      })
      .populate('user_id', 'fullName email mobileNumber userRole')
      .populate('assignedTo', 'fullName email mobileNumber userRole')
      .populate('assignToContractor', 'fullName email mobileNumber userRole')
      .sort({ updatedAt: -1, createdAt: -1 });

    const formattedSurveys = await formatSurveysForResponse(surveys, surveyBaseUrl);

    const surveysWithCustomerDetails = await Promise.all(
      formattedSurveys.map(async (survey, index) => {
        const customerDetails = await formatCustomerForSurveyResponse(
          surveys[index].customer_id,
          materialBaseUrl
        );

        return {
          ...survey,
          customer_id: customerDetails,
        };
      })
    );

    return res.status(200).json({
      message: 'Inspection list retrieved successfully.',
      total: surveysWithCustomerDetails.length,
      surveys: surveysWithCustomerDetails,
    });

  } catch (error) {
    console.error('Inspection list by user error:', error);

    return res.status(500).json({
      message: 'Server error fetching inspection list.',
      error: error.message,
    });
  }
};

exports.addInstallationNote = async (req, res) => {
  try {
    const { id } = req.params;
    const { note, timestamp } = req.body;

    if (!note) {
      return res.status(400).json({ message: 'note is required.' });
    }

    const customer = await Customer.findById(id);
    if (!customer) {
      return res.status(404).json({ message: 'Customer not found.' });
    }

    const newNote = { note, timestamp: timestamp ? new Date(timestamp) : new Date() };
    customer.installationNotes.push(newNote);
    await customer.save();

    await createLog('Installation Note Added', req.user.id, customer.name, 'Customer', customer._id);

    return res.status(201).json({
      message: 'Installation note added successfully.',
      installationNotes: customer.installationNotes,
    });
  } catch (error) {
    console.error('Add installation note error:', error);
    return res.status(500).json({ message: 'Server error adding installation note.' });
  }
};

exports.addInspectionNote = async (req, res) => {
  try {
    const { id } = req.params;
    const { note, timestamp } = req.body;

    if (!note) {
      return res.status(400).json({ message: 'note is required.' });
    }

    const customer = await Customer.findById(id);
    if (!customer) {
      return res.status(404).json({ message: 'Customer not found.' });
    }

    const newNote = { note, timestamp: timestamp ? new Date(timestamp) : new Date() };
    customer.inspectionNotes.push(newNote);
    await customer.save();

    await createLog('Inspection Note Added', req.user.id, customer.name, 'Customer', customer._id);

    return res.status(201).json({
      message: 'Inspection note added successfully.',
      inspectionNotes: customer.inspectionNotes,
    });
  } catch (error) {
    console.error('Add inspection note error:', error);
    return res.status(500).json({ message: 'Server error adding inspection note.' });
  }
};

exports.scheduleInstallation = async (req, res) => {
  try {
    const user_id = req.user.id;
    const surveyId = req.body.survey_id ?? req.body.surveyId;
    const {
      date,
      installation_date,
      installationDate,
      time,
      time_slot,
      installation_time,
      installationTime,
    } = req.body;

    const Admin = require('../models/Admin');
    const isAdmin = await Admin.findById(user_id);
    let isAuthorized = !!isAdmin;

    if (!isAuthorized) {
      const user = await User.findById(user_id);
      if (user && user.userRole === 'Project Manager') {
        isAuthorized = true;
      }
    }

    if (!isAuthorized) {
      return res.status(403).json({
        message: 'Only admins or project managers can schedule installation.',
      });
    }

    if (!surveyId) {
      return res.status(400).json({ message: 'survey_id is required.' });
    }

    const scheduleDate = date ?? installation_date ?? installationDate;
    if (!scheduleDate) {
      return res.status(400).json({ message: 'date is required.' });
    }

    const parsedDate = new Date(scheduleDate);
    if (Number.isNaN(parsedDate.getTime())) {
      return res.status(400).json({ message: 'Invalid date.' });
    }

    const survey = await Survey.findById(surveyId);
    if (!survey) {
      return res.status(404).json({ message: 'Survey not found.' });
    }

    survey.installationDate = parsedDate;
    survey.projectManagerStatus = 'scheduled';
    survey.installationTime = (time ?? time_slot ?? installation_time ?? installationTime ?? '')
      .toString()
      .trim();

    await survey.save();

    const customer = survey.customer_id
      ? await Customer.findById(survey.customer_id).select('name')
      : null;

    await createLog(
      'Survey Installation Scheduled',
      user_id,
      customer?.name || survey.surveyName || 'Survey',
      'Survey',
      survey._id
    );

    return res.status(200).json({
      message: 'Installation scheduled successfully.',
      survey_id: survey._id,
      installationDate: survey.installationDate,
      installationTime: survey.installationTime,
    });
  } catch (error) {
    console.error('Schedule installation error:', error);
    return res.status(500).json({ message: 'Server error scheduling installation.' });
  }
};

exports.updateInstallationStatus = async (req, res) => {
  try {
    const surveyId = req.body.survey_id ?? req.body.surveyId;
    if (!surveyId) {
      return res.status(400).json({ message: 'survey_id is required.' });
    }

    const survey = await Survey.findByIdAndUpdate(
      surveyId,
      {
        installationStatus: 'submitted',
        inspectionStatus: 'to-do',
      },
      { new: true, runValidators: true }
    );

    if (!survey) {
      return res.status(404).json({ message: 'Survey not found.' });
    }

    await createLog(
      'Survey Installation Status Updated to completed',
      req.user.id,
      survey.surveyName || 'Survey',
      'Survey',
      survey._id
    );

    return res.status(200).json({
      message: "Installation status updated successfully.",
      survey,
    });
  } catch (error) {
    console.error('Update installation status error:', error);
    return res.status(500).json({ message: 'Server error updating installation status.' });
  }
};

exports.confirmMaterialStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const status = 'verified'; // Automatically update to verified

    const user_id = req.user.id;

    // Check if user is Admin
    const Admin = require('../models/Admin');

    const customer = await Customer.findByIdAndUpdate(
      id,
      { materialStatus: status },
      { new: true, runValidators: true }
    );

    if (!customer) {
      return res.status(404).json({ message: 'Customer not found.' });
    }

    const { createLog } = require('../utils/logger');
    await createLog(`Customer Material Status ${status}`, user_id, customer.name, 'Customer', customer._id);

    return res.status(200).json({
      message: `Customer material status updated to ${status} successfully.`,
      customer,
    });
  } catch (error) {
    console.error('Confirm material status error:', error);
    return res.status(500).json({ message: 'Server error confirming material status.' });
  }
};

exports.updateInspectionStatus = async (req, res) => {
  try {
    const user_id = req.user.id;
    const surveyId = req.body.survey_id ?? req.body.surveyId;
    const requestedStatus = (req.body.status ?? 'submitted').toString().trim().toLowerCase();

    if (!surveyId) {
      return res.status(400).json({ message: 'survey_id is required.' });
    }

    if (!['submitted', 'verified'].includes(requestedStatus)) {
      return res.status(400).json({
        message: 'Invalid inspection status. Allowed values: submitted, verified.',
      });
    }

    const survey = await Survey.findById(surveyId).select(
      'inspectionStatus customer_id surveyName'
    );

    if (!survey) {
      return res.status(404).json({ message: 'Survey not found.' });
    }

    if (survey.inspectionStatus === 'verified') {
      return res.status(400).json({ message: 'Inspection is already verified.' });
    }

    const currentStatus = (survey.inspectionStatus || '').toString().trim().toLowerCase();

    if (requestedStatus === 'verified' && !['submitted', 'confirm'].includes(currentStatus)) {
      return res.status(400).json({
        message: 'Inspection is not ready for admin approval yet.',
      });
    }

    const nextStatus = requestedStatus === 'verified' ? 'verified' : 'submitted';
    const updateFields = {
      inspectionStatus: 'submitted',
      inspectionDate: new Date(),
    };

    const updatedSurvey = await Survey.findByIdAndUpdate(
      surveyId,
      { $set: updateFields },
      { new: true, runValidators: true }
    );

    if (survey.customer_id) {
      try {
        await Customer.updateOne(
          { _id: survey.customer_id },
          { $set: { inspectionStatus: nextStatus } }
        );
      } catch (customerErr) {
        console.warn('Customer inspectionStatus sync warning:', customerErr.message);
      }
    }

    await createLog(
      requestedStatus === 'verified'
        ? 'Inspection verified by admin'
        : 'Inspection status update successfully',
      user_id,
      survey.surveyName || 'Survey',
      'Survey',
      survey._id
    );

    return res.status(200).json({
      message:
        requestedStatus === 'verified'
          ? 'Inspection verified successfully.'
          : 'Inspection status update successfully.',
      survey: updatedSurvey,
    });
  } catch (error) {
    console.error('Update inspection status error:', error);
    const validationMessage =
      error?.name === 'ValidationError'
        ? Object.values(error.errors || {})
            .map((entry) => entry.message)
            .join(' ')
        : error?.message || '';
    return res.status(500).json({
      message: validationMessage || 'Server error verifying inspection.',
    });
  }
};

