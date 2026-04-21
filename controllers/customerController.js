const Customer = require('../models/Customer');

const ALLOWED_STATUSES = ['New', 'In Progress', 'Closed'];

exports.listCustomers = async (req, res) => {
  try {
    const { status, salesPerson, contractor } = req.query;
    const filter = {};

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
    const customer = await Customer.findById(id);

    if (!customer) {
      return res.status(404).json({ message: 'Customer not found.' });
    }

    return res.status(200).json({ customer });
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
      address,
      activities,
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
