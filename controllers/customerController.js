const mongoose = require('mongoose');
const Customer = require('../models/Customer');
const Lead = require('../models/Lead');
const Survey = require('../models/Survey');
const User = require('../models/User');
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
      surveyObj.areas = (surveyObj.areas || []).map((area) => ({
        ...area,
        images: (area.images || []).map((img) => {
          const filename = String(img || '').replace(/^\//, '');
          if (!filename) return img;
          if (filename.startsWith('http')) return filename;
          return `${surveyBaseUrl}${filename}`;
        }),
        fixtures: (area.fixtures || []).map((fixture) => ({
          ...fixture,
          images: (fixture.images || []).map((img) => {
            const filename = String(img || '').replace(/^\//, '');
            if (!filename) return img;
            if (filename.startsWith('http')) return filename;
            return `${surveyBaseUrl}${filename}`;
          }),
        })),
      }));
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
    const { id } = req.params;
    const { contractor } = req.body;

    if (!contractor) {
      return res.status(400).json({ message: 'Contractor value is required.' });
    }

    const customer = await Customer.findByIdAndUpdate(
      id,
      {
        assignToContractor: contractor,
        contractorStatus: 'New'
      },
      { new: true }
    ).populate('assignToContractor', 'fullName email userRole mobileNumber');

    if (!customer) {
      return res.status(404).json({ message: 'Customer not found.' });
    }

    await createLog('Contractor Value Assigned', req.user.id, customer.name, 'Customer', customer._id);

    return res.status(200).json({ customer, message: 'Contractor assigned successfully.' });
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

    // Fetch customers assigned to this contractor
    const customers = await Customer.find({
      assignToContractor: userId,
    }).sort({ createdAt: -1 });

    // Fetch all surveys for these customers
    const customerIds = customers.map(customer => customer._id);

    const surveys = await Survey.find({
      customer_id: { $in: customerIds },
    });

    // Attach surveys to customers
    const customersWithSurveys = customers.map(customer => {
      const customerObj = customer.toObject();

      customerObj.surveys = surveys.filter(
        survey =>
          survey.customer_id.toString() === customer._id.toString()
      );

      return customerObj;
    });

    return res.status(200).json({
      customers: customersWithSurveys,
    });

  } catch (error) {
    console.error('Get customers by contractor error:', error);

    return res.status(500).json({
      message: 'Server error fetching customers by contractor.',
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

    // Fetch customers assigned to this project manager
    const customers = await Customer.find({
      assignedTo: userId,
    })
      .populate('assignToContractor', 'fullName email mobileNumber')
      .populate('assignedTo', 'fullName email mobileNumber')
      .populate('user_id', 'fullName name email')
      .sort({ createdAt: -1 });

    // Fetch all surveys for these customers
    const customerIds = customers.map(customer => customer._id);

    const surveys = await Survey.find({
      customer_id: { $in: customerIds },
    }).sort({ createdAt: -1 });

    const surveyBaseUrl = "https://ramgeneral-api.onrender.com/uploads/surveys/";
    const materialBaseUrl = "https://ramgeneral-api.onrender.com/uploads/materials/";

    // Attach surveys and fix image URLs
    const customersWithDetails = customers.map(customer => {
      const customerObj = customer.toObject();

      // Filter surveys for this customer
      customerObj.surveys = surveys
        .filter(s => s.customer_id.toString() === customer._id.toString())
        .map(survey => {
          const sObj = survey.toObject();
          sObj.images = (sObj.images || []).map(img => `${surveyBaseUrl}${img}`);
          return sObj;
        });

      if (customerObj.material && Array.isArray(customerObj.material)) {
        customerObj.material = customerObj.material.map(item => {
          item.images = (item.images || []).map(img => `${materialBaseUrl}${img}`);
          return item;
        });
      }

      return customerObj;
    });

    return res.status(200).json({
      message: 'Customers retrieved successfully for Project Manager.',
      total: customersWithDetails.length,
      customers: customersWithDetails,
    });

  } catch (error) {
    console.error('Get customers by PM error:', error);
    return res.status(500).json({
      message: 'Server error fetching customers for Project Manager.',
      error: error.message,
    });
  }
};

exports.addCustomerMaterial = async (req, res) => {
  try {
    const { id } = req.params;
    const { item_name, issued_qty, issued_date, materialStatus } = req.body;

    const user_id = req.user.id;

    // Check permissions (Admin or Project Manager)
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
      return res.status(403).json({ message: 'Only admins or project managers can update materials.' });
    }

    const customer = await Customer.findById(id);
    if (!customer) {
      return res.status(404).json({ message: 'Customer not found.' });
    }

    // Handle single material entry from formData
    if (!item_name || issued_qty === undefined) {
      return res.status(400).json({ message: 'item_name and issued_qty are required.' });
    }

    let savedFilenames = [];
    if (req.files && Array.isArray(req.files)) {
      savedFilenames = req.files.map(file => file.filename);
    }

    customer.material.push({
      item_name: item_name,
      issued_qty: Number(issued_qty),
      issued_date: issued_date ? new Date(issued_date) : new Date(),
      images: savedFilenames
    });

    if (materialStatus) {
      customer.materialStatus = materialStatus;
    }

    await customer.save();

    // Map image to full URL for response
    const materialBaseUrl = "https://ramgeneral-api.onrender.com/uploads/materials/";
    const updatedCustomer = customer.toObject();
    if (updatedCustomer.material) {
      updatedCustomer.material = updatedCustomer.material.map(item => {
        item.images = (item.images || []).map(img => `${materialBaseUrl}${img}`);
        return item;
      });
    }

    await createLog('Customer Materials Updated', user_id, customer.name, 'Customer', customer._id);

    return res.status(200).json({
      message: 'Material added successfully.',
      customer: updatedCustomer,
    });
  } catch (error) {
    console.error('Add customer material error:', error);
    return res.status(500).json({ message: 'Server error updating materials.' });
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
        confirmDate: { $ne: null },
      });
    }
    if (!survey) {
      survey = await Survey.findOne({
        customer_id: id,
        confirmDate: { $ne: null },
      }).sort({ createdAt: -1 });
    }

    if (!survey) {
      return res.status(404).json({ message: 'No verified survey found for this customer.' });
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
      dynamicCommission =
        type === 'Installation' ? payables.contractorCommission : payables.salesCommission;
      quotationNumber = payables.quotationNumber || '';
      quotationAmount = payables.quotationAmount || 0;
    }

    const record = survey ? findCommissionRecord(customer, survey._id, type) : null;
    const paid = sumCommissionPayments(record);
    const pending = Math.max(0, dynamicCommission - paid);

    return res.status(200).json({
      message: 'Payable details retrieved successfully.',
      details: {
        customerId: customer._id,
        surveyId: survey?._id || null,
        commissionId: record?._id || null,
        legalName: customer.legalName || customer.name || '',
        commission: dynamicCommission,
        paid,
        pending,
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
    const { surveyId, for: payableFor, amount, paymentMethod, paymentDate } = req.body;

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
    });

    await customer.save();
    await createLog('Commission Payment Added', req.user.id, customer.name, 'Customer', customer._id);

    return res.status(200).json({
      message: 'Commission payment added successfully.',
      details: {
        customerId: customer._id,
        surveyId,
        commission: result.dynamicAmount,
        paid: result.paid,
        pending: result.pending,
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
    const verifiedSurveys = await Survey.find({ confirmDate: { $ne: null } }).sort({
      surveyDate: -1,
      createdAt: -1,
    });

    const customerIdSet = new Set(
      verifiedSurveys
        .map((survey) => survey.customer_id?.toString())
        .filter(Boolean)
    );

    if (!customerIdSet.size) {
      return res.status(200).json({
        message: 'Verified survey payables retrieved successfully.',
        salesPersons: [],
        contractors: [],
        overallSummary: {
          salesPersons: { totalCommission: 0, totalPaid: 0, totalPending: 0 },
          contractors: { totalCommission: 0, totalPaid: 0, totalPending: 0 },
        },
      });
    }

    const customers = await Customer.find({ _id: { $in: [...customerIdSet] } })
      .populate('assignToContractor', 'fullName email')
      .populate('user_id', 'fullName email name')
      .populate('leadId', 'dba leadName')
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

    for (const survey of verifiedSurveys) {
      const key = survey.customer_id?.toString();
      if (!key) continue;
      if (!surveysByCustomer.has(key)) surveysByCustomer.set(key, []);
      surveysByCustomer.get(key).push(survey);
    }

    const salesPersons = [];
    const contractors = [];

    let salesTotalCommission = 0;
    let salesTotalPaid = 0;
    let salesTotalPending = 0;
    let contractorTotalCommission = 0;
    let contractorTotalPaid = 0;
    let contractorTotalPending = 0;

    for (const customer of customers) {
      const customerKey = customer._id.toString();
      const customerSurveys = surveysByCustomer.get(customerKey) || [];
      const legalName = customer.legalName || customer.name || '';
      const dba = customer.company || customer.leadId?.dba || '';
      const salesPersonName =
        customer.user_id?.fullName || customer.user_id?.name || 'Unassigned';
      const contractorName = customer.assignToContractor?.fullName || 'Unassigned';
      const jobNo = customer.accountNumber || customer.customerCode || '';
      const installDate = getInstallDate(customer);

      for (const survey of customerSurveys) {
        const payables = await calculateSurveyPayables(survey, customer);
        const surveyId = survey._id.toString();

        const salesPayments = getPaymentTotals(
          customer,
          surveyId,
          'Survey',
          payables.salesCommission
        );
        const contractorPayments = getPaymentTotals(
          customer,
          surveyId,
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

        contractors.push({
          id: `${customerKey}-${surveyId}`,
          customerId: customerKey,
          surveyId,
          legalName,
          dba,
          contractor: contractorName,
          jobNo: jobNo || '—',
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
      message: 'Verified survey payables retrieved successfully.',
      salesPersons,
      contractors,
      overallSummary: {
        salesPersons: {
          totalCommission: salesTotalCommission,
          totalPaid: salesTotalPaid,
          totalPending: salesTotalPending,
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

    // Fetch customers
    const customers = await Customer.find({
      assignedTo: userId,
      installationStatus: 'completed',
    })
      .populate('assignToContractor', 'fullName email mobileNumber')
      .populate('assignedTo', 'fullName email mobileNumber')
      .populate('user_id', 'fullName name email')
      .sort({ updatedAt: -1 });

    const materialBaseUrl =
      'https://ramgeneral-api.onrender.com/uploads/materials/';

    const surveyImageBaseUrl =
      'https://ramgeneral-api.onrender.com/uploads/surveys/';

    // Attach surveys manually
    const customerList = await Promise.all(
      customers.map(async (customer) => {
        const obj = customer.toObject();

        // Material images
        if (obj.material) {
          obj.material = obj.material.map((item) => {
            item.images = (item.images || []).map(
              (img) => `${materialBaseUrl}${img}`
            );
            return item;
          });
        }

        // Fetch surveys for this customer
        const surveys = await Survey.find({
          customer_id: customer._id,
        })
          .populate('user_id', 'fullName email mobileNumber')
          .populate('assignedTo', 'fullName email mobileNumber')
          .sort({ createdAt: -1 });

        // Survey images
        const formattedSurveys = surveys.map((survey) => {
          const surveyObj = survey.toObject();

          surveyObj.images = (surveyObj.images || []).map(
            (img) => `${surveyImageBaseUrl}${img}`
          );

          return surveyObj;
        });

        // Add surveys into customer object
        obj.surveys = formattedSurveys;

        return obj;
      })
    );

    return res.status(200).json({
      message: 'Inspection list retrieved successfully.',
      total: customerList.length,
      customers: customerList,
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

exports.updateInstallationStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const allowedStatuses = ['start', 'in_progress', 'continue', 'completed'];
    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({ message: `Invalid status. Allowed: ${allowedStatuses.join(', ')}` });
    }

    const customer = await Customer.findByIdAndUpdate(
      id,
      { installationStatus: status },
      { new: true, runValidators: true }
    );

    if (!customer) {
      return res.status(404).json({ message: 'Customer not found.' });
    }

    await createLog(`Installation Status Updated to ${status}`, req.user.id, customer.name, 'Customer', customer._id);

    return res.status(200).json({
      message: `Installation status updated to '${status}' successfully.`,
      customer,
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
    const { id } = req.params;
    const { status } = req.body;

    const allowedStatuses = ['reopen', 'in_progress', 'confirm'];
    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({ message: `Invalid status. Allowed: ${allowedStatuses.join(', ')}` });
    }

    const customer = await Customer.findByIdAndUpdate(
      id,
      { inspectionStatus: status },
      { new: true, runValidators: true }
    );

    if (!customer) {
      return res.status(404).json({ message: 'Customer not found.' });
    }

    await createLog(`Inspection Status Updated to ${status}`, req.user.id, customer.name, 'Customer', customer._id);

    return res.status(200).json({
      message: `Inspection status updated to '${status}' successfully.`,
      customer,
    });
  } catch (error) {
    console.error('Update inspection status error:', error);
    return res.status(500).json({ message: 'Server error updating inspection status.' });
  }
};

