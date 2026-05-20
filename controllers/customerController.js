const Customer = require('../models/Customer');
const Survey = require('../models/Survey');
const CustomerActivity = require('../models/CustomerActivity');
const { createLog } = require('../utils/logger');
const path = require('path');
const fs = require('fs');

const ALLOWED_STATUSES = ['New', 'In Progress', 'Closed', 'draft', 'in_progress', 'completed'];

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
    const customers = await Customer.find({
      material: { $exists: true, $not: { $size: 0 } },
      contractorStatus: 'completed'
    })
      .populate('assignToContractor', 'fullName email')
      .populate('assignedTo', 'fullName email')
      .populate('user_id', 'fullName')
      .sort({ updatedAt: -1 });

    const materialBaseUrl = "https://ramgeneral-api.onrender.com/uploads/materials/";

    const customerList = customers.map(customer => {
      const customerObj = customer.toObject();
      if (customerObj.material) {
        customerObj.material = customerObj.material.map(item => {
          item.images = (item.images || []).map(img => `${materialBaseUrl}${img}`);
          return item;
        });
      }
      return {
        ...customerObj,
        id: customerObj._id,
        contractorName: customer.assignToContractor?.fullName || ''
      };
    });

    return res.status(200).json({
      message: 'Inspection list retrieved successfully.',
      total: customerList.length,
      customers: customerList
    });
  } catch (error) {
    console.error('List inspections error:', error);
    return res.status(500).json({ message: 'Server error retrieving inspection list.' });
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
    const {
      name,
      company,
      mobileNumber,
      email,
      leadSource,
      lastActivity,
      convertedDate,
      status,
      notes,
      address,
      activityLog,
      surveys, // Array of survey objects to update
    } = req.body;


    const updatedData = {
      ...(name && { name }),
      ...(company && { company }),
      ...(mobileNumber && { mobileNumber }),
      ...(email && { email }),
      ...(leadSource && { leadSource }),
      ...(lastActivity && { lastActivity: new Date(lastActivity) }),
      ...(convertedDate && { convertedDate: new Date(convertedDate) }),
      ...(status && { status }),
      ...(address && { address }),
      ...(activityLog && { activityLog }),
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

    await createLog('Customer Updated', req.user.id, customer.name, 'Customer', customer._id);

    return res.status(200).json({
      customer,
      surveys: surveysWithFullUrls,
      message: 'Customer updated successfully.'
    });
  } catch (error) {
    console.error('Update customer error:', error);
    return res.status(500).json({ message: 'Server error updating customer.', error: error });
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

    const mapCustomer = (customer) => {
      const obj = customer.toObject();
      if (obj.material) {
        obj.material = obj.material.map(item => {
          item.images = (item.images || []).map(img => `${materialBaseUrl}${img}`);
          return item;
        });
      }
      return obj;
    };

    const [assigned, notMapped] = await Promise.all([
      Customer.find({ assignToContractor: userId })
        .populate('assignToContractor', 'fullName email mobileNumber')
        .populate('assignedTo', 'fullName email mobileNumber')
        .populate('user_id', 'fullName name email')
        .sort({ createdAt: -1 }),
      Customer.find({ assignToContractor: null })
        .populate('assignedTo', 'fullName email mobileNumber')
        .populate('user_id', 'fullName name email')
        .sort({ createdAt: -1 }),
    ]);

    return res.status(200).json({
      message: 'Installation list retrieved successfully.',
      assigned: {
        total: assigned.length,
        customers: assigned.map(mapCustomer),
      },
      notMapped: {
        total: notMapped.length,
        customers: notMapped.map(mapCustomer),
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

    const customers = await Customer.find({
      assignedTo: userId,
      installationStatus: 'completed',
    })
      .populate('assignToContractor', 'fullName email mobileNumber')
      .populate('assignedTo', 'fullName email mobileNumber')
      .populate('user_id', 'fullName name email')
      .sort({ updatedAt: -1 });

    const materialBaseUrl = "https://ramgeneral-api.onrender.com/uploads/materials/";

    const customerList = customers.map(customer => {
      const obj = customer.toObject();
      if (obj.material) {
        obj.material = obj.material.map(item => {
          item.images = (item.images || []).map(img => `${materialBaseUrl}${img}`);
          return item;
        });
      }
      return obj;
    });

    return res.status(200).json({
      message: 'Inspection list retrieved successfully.',
      total: customerList.length,
      customers: customerList,
    });
  } catch (error) {
    console.error('Inspection list by user error:', error);
    return res.status(500).json({ message: 'Server error fetching inspection list.' });
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
