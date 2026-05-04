const Service = require('../models/Service');
const Customer = require('../models/Customer');
const Survey = require('../models/Survey');

// Create a service ticket
exports.createService = async (req, res) => {
  try {
    const service = new Service(req.body);
    await service.save();
    res.status(201).json({ success: true, data: service, message: 'Service ticket created successfully' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// Get all service tickets
exports.getAllServices = async (req, res) => {
  try {
    const services = await Service.find()
      .populate('customerId', 'name company email mobileNumber')
      .populate('assignedTo', 'fullName')
      .sort({ createdAt: -1 });
    res.status(200).json({ success: true, data: services });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// Get eligible customers for service (Status: completed)
exports.getEligibleCustomers = async (req, res) => {
  try {
    const customers = await Customer.find({ status: 'completed' })
      .select('name company email mobileNumber');
    res.status(200).json({ success: true, data: customers });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// Get full customer details and surveys for the add service form
exports.getCustomerDetailsForService = async (req, res) => {
  try {
    const { id } = req.params;
    const customer = await Customer.findById(id);
    if (!customer) {
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }
    const surveys = await Survey.find({ customer_id: id });
    
    res.status(200).json({ success: true, data: { customer, surveys } });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};
