const Customer = require('../models/Customer');
const Survey = require('../models/Survey');

const ALLOWED_STATUSES = ['New', 'In Progress', 'Closed'];

exports.listCustomers = async (req, res) => {
  try {
    const user_id = req.user.id;
    console.log(user_id);
    const { status, salesPerson, contractor } = req.query;
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
      console.log(`User ${user.fullName} (${user.userRole}) filtering customers by assignedTo: ${user_id}`);
    } else if (user.userRole === 'project_manager') {
      const assignedCustomerIds = await Customer.distinct('_id', { assignedTo: user_id });
      filter._id = { $in: assignedCustomerIds };
      console.log(`User ${user.fullName} (${user.userRole}) filtering customers by surveys assignedTo: ${user_id}`);
    } else {
      console.log(`User ${user.fullName} (${user.userRole}) seeing all customers`);
    }

    if (status) {
      filter.status = status;
    }

    if (salesPerson) {
      filter.salesPerson = salesPerson;
    }

    if (contractor) {
      filter.contractor = contractor;
    }

    const customers = await Customer.find(filter).sort({ createdAt: -1 });
    const customerSummaries = customers.map((customer) => ({
      id: customer._id,
      accountNumber: customer.accountNumber,
      name: customer.name,
      company: customer.company,
      mobileNumber: customer.mobileNumber,
      createdDate: customer.createdAt,
      convertedDate: customer.convertedDate,
      salesPerson: customer.salesPerson,
      contractor: customer.contractor,
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
    const { salesPerson, contractor, status } = req.query;
    const filter = { leadId: { $ne: null } };

    if (salesPerson) {
      filter.salesPerson = salesPerson;
    }

    if (contractor) {
      filter.contractor = contractor;
    }

    if (status) {
      filter.status = status;
    }

    const customers = await Customer.find(filter)
      .populate('leadId', 'name company email mobileNumber leadSource status convertedToCustomer')
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
      contractor: customer.contractor,
      status: customer.status,
      lastActivity: customer.lastActivity,
      assignedTo: customer.assignedTo ?? null,
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

    const baseUrl = "https://ramgeneral-api.onrender.com/uploads/surveys/";

    // ✅ Convert survey images to full URLs
    const surveysWithFullUrls = surveys.map(survey => {
      const surveyObj = survey.toObject();

      // ✅ Convert image filenames to full URLs
      surveyObj.images = (surveyObj.images || []).map(img =>
        `${baseUrl}${img}`
      );

      return surveyObj;
    });

    return res.status(200).json({
      customer,
      surveys: surveysWithFullUrls,
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
      contractor,
      lastActivity,
      convertedDate,
      status,
      notes,
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
      ...(contractor && { contractor }),
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

    return res.status(200).json({ customer, message: 'Customer updated successfully.' });
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
      contractor: customer.contractor,
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
    const materials = req.body; // Expecting an array of materials

    // Role check
    const User = require('../models/User');
    const user = await User.findById(req.user.id);

    if (!user || user.userRole !== 'project_manager') {
      return res.status(403).json({ message: 'Access denied. Only project managers can add materials.' });
    }

    if (!Array.isArray(materials) || materials.length === 0) {
      return res.status(400).json({ message: 'Request body must be a non-empty array of materials.' });
    }

    const customer = await Customer.findById(id);
    if (!customer) {
      return res.status(404).json({ message: 'Customer not found.' });
    }

    // Add each material from the request array
    for (const item of materials) {
      if (!item.item_name || item.issued_qty === undefined) {
        return res.status(400).json({ message: 'Each material must have item_name and issued_qty.' });
      }
      customer.material.push({
        item_name: item.item_name,
        issued_qty: item.issued_qty,
        issued_date: item.issued_date ? new Date(item.issued_date) : new Date(),
      });
    }

    await customer.save();

    return res.status(200).json({
      message: 'Materials added successfully.',
      total_added: materials.length,
      customer,
    });
  } catch (error) {
    console.error('Add customer material error:', error);
    return res.status(500).json({ message: 'Server error adding materials.' });
  }
};

exports.assignToContractor = async (req, res) => {
  try {
    const { id } = req.params;
    const { contractorId, contractorName } = req.body;

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

    const updatedData = {
      assignToContractor: contractorId,
      contractorStatus: 'New',
    };

    if (contractorName) {
      updatedData.contractor = contractorName;
    } else {
      updatedData.contractor = contractorUser.fullName;
    }

    const customer = await Customer.findByIdAndUpdate(
      id,
      updatedData,
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
    const { status } = req.body; // 'verified' or 'rejected'

    if (!['verified', 'rejected'].includes(status)) {
      return res.status(400).json({ message: "Invalid status. Use 'verified' or 'rejected'." });
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

    return res.status(200).json({
      message: `Customer survey ${status} successfully.`,
      customer,
    });
  } catch (error) {
    console.error('Verify customer error:', error);
    return res.status(500).json({ message: 'Server error verifying customer.' });
  }
};

