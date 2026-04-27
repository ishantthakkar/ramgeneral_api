const Customer = require('../models/Customer');
const Survey = require('../models/Survey');
const CustomerActivity = require('../models/CustomerActivity');
const { createLog } = require('../utils/logger');
const path = require('path');
const fs = require('fs');

const ALLOWED_STATUSES = ['New', 'In Progress', 'Closed'];

// Helper function to save base64 image
const saveBase64Image = (base64String, uploadDir) => {
  try {
    const matches = base64String.match(/^data:([A-Za-z-+\/]+);base64,([\s\S]+)$/);
    if (!matches || matches.length !== 3) return null;

    const type = matches[1];
    const buffer = Buffer.from(matches[2], 'base64');
    const extension = type.split('/')[1].split('+')[0] || 'jpg';
    const fileName = `${Date.now()}-${Math.floor(Math.random() * 10000)}.${extension}`;
    const filePath = path.join(uploadDir, fileName);

    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    fs.writeFileSync(filePath, buffer);
    return fileName;
  } catch (error) {
    console.error('Error saving base64 image:', error);
    return null;
  }
};

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
    } else if (user.userRole === 'project_manager') {
      const assignedCustomerIds = await Customer.distinct('_id', { assignedTo: user_id });
      filter._id = { $in: assignedCustomerIds };
    }

    if (status) {
      filter.status = status;
    }

    if (salesPerson) {
      filter.salesPerson = salesPerson;
    }

    const customers = await Customer.find(filter)
      .populate('assignToContractor', 'fullName email')
      .sort({ createdAt: -1 });

    const customerSummaries = customers.map((customer) => ({
      id: customer._id,
      accountNumber: customer.accountNumber,
      name: customer.name,
      company: customer.company,
      mobileNumber: customer.mobileNumber,
      createdDate: customer.createdAt,
      convertedDate: customer.convertedDate,
      salesPerson: customer.salesPerson,
      contractor: customer.assignToContractor?.fullName || '',
      lastActivity: customer.lastActivity,
      status: customer.status,
      assignedTo: customer.assignedTo,
    }));

    return res.status(200).json({ customers: customerSummaries });
  } catch (error) {
    console.error('List customers error:', error);
    return res.status(500).json({ message: 'Server error listing customers.' });
  }
};

exports.listConvertedCustomers = async (req, res) => {
  try {
    const { salesPerson, status } = req.query;
    const filter = { leadId: { $ne: null } };

    if (salesPerson) {
      filter.salesPerson = salesPerson;
    }

    if (status) {
      filter.status = status;
    }

    const customers = await Customer.find(filter)
      .populate('leadId', 'name company email mobileNumber leadSource status convertedToCustomer')
      .populate('assignToContractor', 'fullName email')
      .sort({ convertedDate: -1 });

    const customerSummaries = customers.map((customer) => ({
      id: customer._id,
      accountNumber: customer.accountNumber,
      name: customer.name,
      company: customer.company,
      email: customer.email,
      mobileNumber: customer.mobileNumber,
      leadSource: customer.leadSource,
      createdDate: customer.createdAt,
      convertedDate: customer.convertedDate,
      salesPerson: customer.salesPerson,
      contractor: customer.assignToContractor?.fullName || '',
      status: customer.status,
      lastActivity: customer.lastActivity,
      assignedTo: customer.assignedTo ?? null,
      verifyStatus: customer.verifyStatus,
      lead: customer.leadId
        ? {
          id: customer.leadId._id,
          name: customer.leadId.name,
          company: customer.leadId.company,
          email: customer.leadId.email,
          mobileNumber: customer.leadId.mobileNumber,
          leadSource: customer.leadId.leadSource,
          status: customer.leadId.status,
        }
        : null,
    }));

    return res.status(200).json({
      message: 'Converted customers retrieved successfully.',
      total: customerSummaries.length,
      customers: customerSummaries,
    });
  } catch (error) {
    console.error('List converted customers error:', error);
    return res.status(500).json({ message: 'Server error listing converted customers.' });
  }
};

exports.getCustomer = async (req, res) => {
  try {
    const { id } = req.params;

    // ✅ Get customer
    const customer = await Customer.findById(id);
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
      updatedCustomer.material = updatedCustomer.material.map(item => ({
        ...item,
        image: item.image ? `${materialBaseUrl}${item.image}` : ''
      }));
    }

    return res.status(200).json({
      customer: updatedCustomer,
      surveys: surveysWithFullUrls,
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
    const {
      name,
      company,
      mobileNumber,
      email,
      leadSource,
      salesPerson,
      lastActivity,
      convertedDate,
      status,
      notes,
      address,
      activities,
      surveys, // Array of survey objects to update
    } = req.body;

    if (status && !ALLOWED_STATUSES.includes(status)) {
      return res.status(400).json({
        message: `Invalid status. Allowed values: ${ALLOWED_STATUSES.join(', ')}`,
      });
    }


    const updatedData = {
      ...(name && { name }),
      ...(company && { company }),
      ...(mobileNumber && { mobileNumber }),
      ...(email && { email }),
      ...(leadSource && { leadSource }),
      ...(salesPerson && { salesPerson }),
      ...(lastActivity && { lastActivity: new Date(lastActivity) }),
      ...(convertedDate && { convertedDate: new Date(convertedDate) }),
      ...(status && { status }),
      ...(address && { address }),
      ...(activities && { activities }),
      ...(notes && { notes }),
    };

    const customer = await Customer.findByIdAndUpdate(id, updatedData, {
      new: true,
      runValidators: true,
    });

    if (!customer) {
      return res.status(404).json({ message: 'Customer not found.' });
    }

    // ✅ If surveys are provided, update them
    if (surveys && Array.isArray(surveys)) {
      const Survey = require('../models/Survey');
      for (const surveyData of surveys) {
        if (surveyData._id) {
          const { _id, ...updateFields } = surveyData;
          await Survey.findByIdAndUpdate(_id, updateFields, {
            new: true,
            runValidators: true,
          });
        }
      }
    }

    // ✅ Get updated surveys to return in response
    const Survey = require('../models/Survey');
    const updatedSurveys = await Survey.find({ customer_id: id }).sort({ createdAt: -1 });

    // ✅ Convert survey and material images to full URLs for the response
    const surveyBaseUrl = "https://ramgeneral-api.onrender.com/uploads/surveys/";
    const materialBaseUrl = "https://ramgeneral-api.onrender.com/uploads/materials/";

    const surveysWithFullUrls = updatedSurveys.map(survey => {
      const surveyObj = survey.toObject();
      surveyObj.images = (surveyObj.images || []).map(img => `${surveyBaseUrl}${img}`);
      return surveyObj;
    });

    return res.status(200).json({
      customer,
      surveys: surveysWithFullUrls,
      message: 'Customer and surveys updated successfully.'
    });
  } catch (error) {
    console.error('Update customer error:', error);
    return res.status(500).json({ message: 'Server error updating customer.' });
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
      { contractor },
      { new: true, runValidators: true }
    );

    if (!customer) {
      return res.status(404).json({ message: 'Customer not found.' });
    }

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
    if (user.userRole !== 'contractor' && user.userRole !== 'project_manager') {
      return res.status(403).json({ message: 'Access denied. Only contractors and project managers can view assigned customers.' });
    }

    const filter = { assignedTo: user_id };

    if (status) {
      filter.status = status;
    }

    if (salesPerson) {
      filter.salesPerson = salesPerson;
    }

    const customers = await Customer.find(filter)
      .sort({ createdAt: -1 })
      .populate('assignedTo', 'fullName email userRole')
      .populate('user_id', 'fullName email');

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
      salesPerson: customer.salesPerson,
      contractor: customer.assignToContractor?.fullName || '',
      lastActivity: customer.lastActivity,
      status: customer.status,
      assignedTo: customer.assignedTo,
      createdBy: customer.user_id,
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

    if (assignedUser.userRole !== 'contractor' && assignedUser.userRole !== 'project_manager') {
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

exports.addCustomerMaterial = async (req, res) => {
  try {
    const { id } = req.params;
    const { materials, materialStatus } = req.body;

    const user_id = req.user.id;

    // Check permissions (Admin or Project Manager)
    const Admin = require('../models/Admin');
    const isAdmin = await Admin.findById(user_id);
    let isAuthorized = !!isAdmin;

    if (!isAuthorized) {
      const User = require('../models/User');
      const user = await User.findById(user_id);
      if (user && user.userRole === 'project_manager') {
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

    const uploadDir = path.join(__dirname, '../uploads/materials');

    // Handle materials array if provided
    if (materials && Array.isArray(materials)) {
      for (const item of materials) {
        if (!item.item_name || item.issued_qty === undefined) {
          return res.status(400).json({ message: 'Each material must have item_name and issued_qty.' });
        }

        let savedFilename = '';
        if (item.image) {
          if (item.image.startsWith('data:')) {
            savedFilename = saveBase64Image(item.image, uploadDir) || '';
          } else {
            savedFilename = item.image.split('/').pop();
          }
        }

        customer.material.push({
          item_name: item.item_name,
          issued_qty: item.issued_qty,
          issued_date: item.issued_date ? new Date(item.issued_date) : new Date(),
          image: savedFilename
        });
      }
    }

    if (materialStatus) {
      customer.materialStatus = materialStatus;
    }

    await customer.save();

    // Map image to full URL for response
    const materialBaseUrl = "https://ramgeneral-api.onrender.com/uploads/materials/";
    const updatedCustomer = customer.toObject();
    if (updatedCustomer.material) {
      updatedCustomer.material = updatedCustomer.material.map(item => ({
        ...item,
        image: item.image ? `${materialBaseUrl}${item.image}` : ''
      }));
    }

    return res.status(200).json({
      message: 'Materials updated successfully.',
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
      if (user && user.userRole === 'project_manager') {
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

    return res.status(200).json({
      message: 'Customer assigned to contractor successfully.',
      customer
    });
  } catch (error) {
    console.error('Assign to contractor error:', error);
    return res.status(500).json({ message: 'Server error assigning to contractor.' });
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
      if (!user || user.userRole !== 'project_manager') {
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
    const { activityType, date, outcome, nextFollowUpDate } = req.body;

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

exports.updateCustomerCommissions = async (req, res) => {
  try {
    const { id } = req.params;
    const { commissions } = req.body; // Expecting an array of commission objects

    if (!Array.isArray(commissions)) {
      return res.status(400).json({ message: 'commissions must be an array.' });
    }

    const customer = await Customer.findById(id);
    if (!customer) {
      return res.status(404).json({ message: 'Customer not found.' });
    }

    // This replaces or appends? I'll overwrite with new set if they send the whole list,
    // or just append. Usually "add" APIs append. I'll append for now.
    customer.commissions = [...customer.commissions, ...commissions];
    await customer.save();

    const { createLog } = require('../utils/logger');
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

