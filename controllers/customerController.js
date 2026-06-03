const Customer = require('../models/Customer');
const Lead = require('../models/Lead');
const Survey = require('../models/Survey');
const CustomerActivity = require('../models/CustomerActivity');
const { createLog } = require('../utils/logger');
const { resolveLeadSourceCode } = require('../constants/leadSources');
const {
  tryParseJson,
  mergeSubdocuments,
  normalizeAddresses,
  normalizeContactInfo,
  normalizeNotes,
  normalizeActivityLog,
  normalizeBillFilenames,
  resolveNewBillFilenames,
} = require('../utils/subdocumentHelpers');
const path = require('path');
const fs = require('fs');

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
      .populate('leadId', 'name company email mobileNumber leadSource status convertedToCustomer user_id')
      .populate('assignToContractor', 'fullName email')
      .populate('user_id', 'fullName')
      .sort({ convertedDate: -1 });

    const materialBaseUrl = "https://ramgeneral-api.onrender.com/uploads/materials/";

    const customerSummaries = customers.map((customer) => ({
      id: customer._id,
      lead_id: customer.lead_id || '',
      leadId: customer.lead_id || '',
      leadName: customer.leadName || customer.name || '',
      dba: customer.dba,
      legalName: customer.legalName,
      electricCompany: customer.electricCompany,
      uploadElectricityBill: normalizeBillFilenames(customer.uploadElectricityBill),
      addresses: customer.addresses,
      contactInfo: customer.contactInfo,
      notes: customer.notes,
      activityLog: customer.activityLog,
      createdByName: customer.createdByName,
      createdByEmail: customer.createdByEmail,
      createdByRole: customer.createdByRole,
      accountNumber: customer.accountNumber,
      name: customer.name,
      company: customer.company,
      email: customer.email,
      mobileNumber: customer.mobileNumber,
      leadSource: customer.leadSource,
      createdDate: customer.createdAt,
      convertedDate: customer.convertedDate,
      contractor: customer.assignToContractor?.fullName || '',
      status: customer.status,
      lastActivity: customer.lastActivity,
      assignedTo: customer.assignedTo ?? null,
      verifyStatus: customer.verifyStatus,
      salesPersonName: customer.user_id?.fullName || customer.user_id?.name || '',
      material: (customer.material || []).map(m => {
        const materialObj = m.toObject();
        materialObj.images = (materialObj.images || []).map(img => `${materialBaseUrl}${img}`);
        return materialObj;
      })
    }));

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

    // ✅ Get customer
    const customer = await Customer.findById(id)
      .populate('assignToContractor', 'fullName email mobileNumber')
      .populate('assignedTo', 'fullName email mobileNumber')
      .populate('user_id', 'fullName name email');

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

    // ✅ Convert survey images to full URLs
    const surveysWithFullUrls = surveys.map(survey => {
      const surveyObj = survey.toObject();
      surveyObj.images = (surveyObj.images || []).map(img => `${surveyBaseUrl}${img}`);
      return surveyObj;
    });

    // ✅ Convert material image to full URLs
    const updatedCustomer = customer.toObject();
    if (updatedCustomer.material && Array.isArray(updatedCustomer.material)) {
      updatedCustomer.material = updatedCustomer.material.map(item => {
        item.images = (item.images || []).map(img => `${materialBaseUrl}${img}`);
        return item;
      });
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

    setString('leadName');
    setString('name');
    setString('dba');
    setString('legalName');
    setString('accountNumber');
    setString('company');

    if (body.electricCompany !== undefined) {
      customer.electricCompany = body.electricCompany || '';
    }
    if (body.electric_company !== undefined) {
      customer.electricCompany = body.electric_company || '';
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
      const processedNotes = normalizeNotes(body.notes);
      if (processedNotes.length > 0) {
        customer.notes = [...(customer.notes || []), ...processedNotes];
        customer.markModified('notes');
      }
    }

    let processedActivityLog = [];
    const parsedActivityLog = tryParseJson(body.activityLog);
    const activityLogItems = Array.isArray(parsedActivityLog)
      ? parsedActivityLog
      : Array.isArray(body.activityLog)
        ? body.activityLog
        : null;

    if (activityLogItems) {
      processedActivityLog = activityLogItems.map((a) => ({
        activityType: a.activityType,
        date: a.date ? new Date(a.date) : new Date(),
        outcome: a.outcome || '',
        notes: a.notes || '',
        followUpDate: a.followUpDate ? new Date(a.followUpDate) : undefined,
        nextFollowUpDate: a.nextFollowUpDate ? new Date(a.nextFollowUpDate) : undefined,
        createdAt: new Date(),
      }));
    } else if (body.activityType) {
      processedActivityLog = [
        {
          activityType: body.activityType,
          date: body.activityDate ? new Date(body.activityDate) : new Date(),
          outcome: body.outcome || '',
          notes: typeof body.notes === 'string' ? body.notes : '',
          followUpDate: body.followUpDate ? new Date(body.followUpDate) : undefined,
          nextFollowUpDate: body.nextFollowUpDate ? new Date(body.nextFollowUpDate) : undefined,
          createdAt: new Date(),
        },
      ];
    }

    if (processedActivityLog.length > 0) {
      customer.activityLog = [...(customer.activityLog || []), ...processedActivityLog];
      customer.markModified('activityLog');
    }

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

    if (customer.leadId && body.status && LEAD_CREATE_STATUSES.includes(body.status)) {
      await Lead.findByIdAndUpdate(customer.leadId, {
        status: body.status,
        convertedToCustomer: body.status === 'Converted To Customer',
      });
    }

    const updatedSurveys = await Survey.find({ customer_id: id }).sort({ createdAt: -1 });
    const surveyBaseUrl = 'https://ramgeneral-api.onrender.com/uploads/surveys/';
    const billBaseUrl = 'https://ramgeneral-api.onrender.com/uploads/leads/bills/';

    const surveysWithFullUrls = updatedSurveys.map((survey) => {
      const surveyObj = survey.toObject();
      surveyObj.images = (surveyObj.images || []).map((img) => `${surveyBaseUrl}${img}`);
      return surveyObj;
    });

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

exports.assignCustomer = async (req, res) => {
  try {
    const user_id = req.user.id;
    const { id } = req.params;
    const { assignedTo } = req.body;

    // Check if user is admin
    const Admin = require('../models/Admin');
    const admin = await Admin.findById(user_id);
    if (!admin) {
      return res.status(403).json({ message: 'Only admins can assign customers.' });
    }

    if (!assignedTo) {
      return res.status(400).json({ message: 'assignedTo is required.' });
    }

    // Check if assigned user exists and has appropriate role
    const User = require('../models/User');
    const assignedUser = await User.findById(assignedTo);
    if (!assignedUser) {
      return res.status(404).json({ message: 'Assigned user not found.' });
    }

    if (assignedUser.userRole !== 'contractor' && assignedUser.userRole !== 'Project Manager') {
      return res.status(400).json({ message: 'Assigned user must be a contractor or project manager.' });
    }

    const customer = await Customer.findByIdAndUpdate(
      id,
      { assignedTo },
      { new: true, runValidators: true }
    ).populate('assignedTo', 'fullName email userRole');

    if (!customer) {
      return res.status(404).json({ message: 'Customer not found.' });
    }

    await createLog('Customer Assigned to PM/Contractor', user_id, customer.name, 'Assignment', customer._id);

    return res.status(200).json({ customer, message: 'Customer assigned successfully.' });
  } catch (error) {
    console.error('Assign customer error:', error);
    return res.status(500).json({ message: 'Server error assigning customer.' });
  }
};

exports.updateCustomerSurveyStatus = async (req, res) => {
  try {
    const { customerId, status } = req.params;

    // ✅ Validate allowed statuses
    const allowedStatuses = ['in_progress', 'draft', 'completed'];

    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({
        message: `Invalid status. Allowed: ${allowedStatuses.join(', ')}`,
      });
    }

    // ✅ Check customer exists
    const customer = await Customer.findById(customerId);
    if (!customer) {
      return res.status(404).json({ message: 'Customer not found.' });
    }

    // ✅ Update status
    customer.status = status;
    await customer.save();

    return res.status(200).json({
      message: `Customer survey status updated to '${status}' successfully.`,
      customer,
    });

  } catch (error) {
    console.error('Update customer survey status error:', error);
    return res.status(500).json({
      message: 'Server error updating customer survey status.',
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

    // Fetch customers
    const customers = await Customer.find({
      user_id: userId,
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

    if (!['verified', 'pending'].includes(status)) {
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

    const customer = await Customer.findByIdAndUpdate(
      id,
      { verifyStatus: status },
      { new: true, runValidators: true }
    );

    if (!customer) {
      return res.status(404).json({ message: 'Customer not found.' });
    }

    const { createLog } = require('../utils/logger');
    await createLog(`Customer Survey ${status}`, user_id, customer.name, 'Customer', customer._id);

    return res.status(200).json({
      message: `Customer survey ${status} successfully.`,
      customer,
    });
  } catch (error) {
    console.error('Verify customer error:', error);
    return res.status(500).json({ message: 'Server error verifying customer.' });
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

exports.getCustomerActivities = async (req, res) => {dddd
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
    const customers = await Customer.find({ verifyStatus: 'verified' })
      .populate('assignToContractor', 'fullName email')
      .populate('user_id', 'id fullName')
      .populate({
        path: 'commissions.salesPerson',
        model: 'User',
        select: 'fullName email'
      })
      .populate({
        path: 'commissions.contractor',
        model: 'User',
        select: 'fullName email'
      })
      .sort({ createdAt: -1 });

    let totalCommission = 0;
    let totalPaid = 0;
    let totalPending = 0;

    const customerList = customers.map(customer => {
      let customerTotal = 0;
      let customerPaid = 0;
      let customerPending = 0;

      const commissions = (customer.commissions || []).map(comm => {
        const amount = comm.amount || 0;
        const paid = comm.paidAmount || 0;
        const pending = amount - paid;

        customerTotal += amount;
        customerPaid += paid;
        customerPending += pending;

        totalCommission += amount;
        totalPaid += paid;
        totalPending += pending;

        // Get the name of the person this commission is for
        let paidTo = '';
        if (comm.commissionType === 'Survey' && comm.salesPerson) {
          paidTo = comm.salesPerson.fullName || '';
        } else if (comm.commissionType === 'Installation' && comm.contractor) {
          paidTo = comm.contractor.fullName || '';
        } else if (comm.commissionType === 'Other') {
          paidTo = comm.otherName || '';
        }

        return {
          ...comm.toObject(),
          paidTo,
          pending
        };
      });

      return {
        id: customer._id,
        name: customer.name,
        company: customer.company,
        salesPerson: customer.user_id?.fullName || '',
        contractor: customer.assignToContractor?.fullName || '',

        total_overall_amount: customerTotal,
        total_paid_amount: customerPaid,
        total_pending_amount: customerPending,

        commissions
      };
    });

    return res.status(200).json({
      message: 'Verified customer commission list retrieved successfully.',
      total_customers: customerList.length,
      customers: customerList,
      overallSummary: {
        totalCommission,
        totalPaid,
        totalPending
      }
    });

  } catch (error) {
    console.error('Customer commission list error:', error);
    return res.status(500).json({
      message: 'Server error retrieving customer commission list.'
    });
  }
};

exports.editCustomerStatus = async (req, res) => {
  try {
    const { id } = req.params;

    const customer = await Customer.findByIdAndUpdate(
      id,
      { status: 'pending_edit_approval', adminApproval: 'Pending' },
      { new: true, runValidators: true }
    );

    if (!customer) {
      return res.status(404).json({ message: 'Customer not found.' });
    }

    const { createLog } = require('../utils/logger');
    await createLog(`Customer Status Reopened`, req.user.id, customer.name, 'Customer', customer._id);

    return res.status(200).json({
      message: 'Customer status updated to reopen successfully.',
      customer,
    });
  } catch (error) {
    console.error('Edit customer status error:', error);
    return res.status(500).json({ message: 'Server error updating customer status.' });
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
      // Check if user is Project Manager
      const User = require('../models/User');
      const user = await User.findById(user_id);
      if (!user || user.userRole !== 'Project Manager') {
        return res.status(403).json({ message: 'Only Admins or Project Managers can approve or reject.' });
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

