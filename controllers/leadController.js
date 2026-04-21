const Lead = require('../models/Lead');
const Customer = require('../models/Customer');
const User = require('../models/User');

const ALLOWED_STATUSES = ['New', 'In Progress', 'Closed', 'Converted To Customer'];

exports.createLead = async (req, res) => {
  try {
    const { name, company, mobileNumber, email, leadSource, status, street, city, state, zip, notes, salesPerson: salesPersonBody, lastActivity } = req.body;

    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(401).json({ message: 'Invalid user token.' });
    }

    const salesPerson = salesPersonBody || (user.userRole === 'sales_person' ? user.fullName : undefined);

    if (!name || !company || !mobileNumber || !salesPerson || !status) {
      return res.status(400).json({ message: 'name, company, mobileNumber, salesPerson and status are required.' });
    }

    if (!ALLOWED_STATUSES.includes(status)) {
      return res.status(400).json({
        message: `Invalid status. Allowed values: ${ALLOWED_STATUSES.join(', ')}`,
      });
    }

    const lead = await Lead.create({
      name,
      company,
      mobileNumber,
      email: email ? email.toLowerCase() : '',
      leadSource: leadSource || '',
      street: street || '',
      city: city || '',
      state: state || '',
      zip: zip || '',
      notes: notes || '',
      user_id: user._id,
      createdByName: user.fullName,
      createdByEmail: user.email,
      createdByRole: user.userRole,
      salesPerson,
      lastActivity: lastActivity ? new Date(lastActivity) : Date.now(),
      status,
      convertedToCustomer: status === 'Converted To Customer',
    });

    return res.status(201).json({ lead, message: 'Lead created successfully.' });
  } catch (error) {
    console.error('Create lead error:', error);
    return res.status(500).json({ message: 'Server error creating lead.' });
  }
};

exports.listLeads = async (req, res) => {
  try {
    const { status, salesPerson, includeConverted } = req.query;
    const filter = {};

    if (!includeConverted || includeConverted === 'false') {
      filter.convertedToCustomer = false;
    }

    if (status) {
      if (!ALLOWED_STATUSES.includes(status)) {
        return res.status(400).json({
          message: `Invalid status. Allowed values: ${ALLOWED_STATUSES.join(', ')}`,
        });
      }
      filter.status = status;
    }

    if (salesPerson) {
      filter.salesPerson = salesPerson;
    }

    const leads = await Lead.find(filter).sort({ createdAt: -1 });
    const leadSummaries = leads.map((lead) => ({
      id: lead._id,
      name: lead.name,
      company: lead.company,
      mobileNumber: lead.mobileNumber,
      email: lead.email,
      leadSource: lead.leadSource,
      street: lead.street,
      city: lead.city,
      state: lead.state,
      zip: lead.zip,
      notes: lead.notes,
      createdDate: lead.createdAt,
      salesPerson: lead.salesPerson,
      lastActivity: lead.lastActivity,
      status: lead.status,
      user_id: lead.user_id,
      createdByName: lead.createdByName,
    }));

    return res.status(200).json({ leads: leadSummaries });
  } catch (error) {
    console.error('List leads error:', error);
    return res.status(500).json({ message: 'Server error listing leads.' });
  }
};

exports.getLead = async (req, res) => {
  try {
    const { id } = req.params;
    const lead = await Lead.findById(id);

    if (!lead) {
      return res.status(404).json({ message: 'Lead not found.' });
    }

    return res.status(200).json({ lead });
  } catch (error) {
    console.error('Get lead error:', error);
    return res.status(500).json({ message: 'Server error fetching lead.' });
  }
};

exports.updateLead = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, company, mobileNumber, email, leadSource, status, address, notes, salesPerson, lastActivity } = req.body;
    const updateData = {};

    if (name) updateData.name = name;
    if (company) updateData.company = company;
    if (mobileNumber) updateData.mobileNumber = mobileNumber;
    if (email) updateData.email = email.toLowerCase();
    if (leadSource) updateData.leadSource = leadSource;
    if (street) updateData.street = street;
    if (city) updateData.city = city;
    if (state) updateData.state = state;
    if (zip) updateData.zip = zip;
    if (notes) updateData.notes = notes;
    if (salesPerson) updateData.salesPerson = salesPerson;
    if (lastActivity) updateData.lastActivity = new Date(lastActivity);
    if (status) {
      if (!ALLOWED_STATUSES.includes(status)) {
        return res.status(400).json({
          message: `Invalid status. Allowed values: ${ALLOWED_STATUSES.join(', ')}`,
        });
      }
      updateData.status = status;
      updateData.convertedToCustomer = status === 'Converted To Customer';
    }

    const updatedLead = await Lead.findByIdAndUpdate(id, updateData, {
      new: true,
      runValidators: true,
    });

    if (!updatedLead) {
      return res.status(404).json({ message: 'Lead not found.' });
    }

    return res.status(200).json({ lead: updatedLead, message: 'Lead updated successfully.' });
  } catch (error) {
    console.error('Update lead error:', error);
    return res.status(500).json({ message: 'Server error updating lead.' });
  }
};

exports.convertToCustomer = async (req, res) => {
  try {
    const { id } = req.params;
    const lead = await Lead.findById(id);

    if (!lead) {
      return res.status(404).json({ message: 'Lead not found.' });
    }

    let customer = await Customer.findOne({ leadId: lead._id });
    if (!customer) {
      customer = await Customer.create({
        leadId: lead._id,
        user_id: req.user.id,
        name: lead.name,
        company: lead.company,
        mobileNumber: lead.mobileNumber,
        email: lead.email,
        leadSource: lead.leadSource,
        salesPerson: lead.salesPerson,
        convertedDate: new Date(),
        lastActivity: lead.lastActivity,
        status: 'New',
        address: {
          street: lead.street,
          city: lead.city,
          state: lead.state,
          zip: lead.zip,
        },
        notes: lead.notes ? [{ note: lead.notes, createdAt: new Date() }] : [],
      });
    }

    lead.status = 'Converted To Customer';
    lead.convertedToCustomer = true;
    await lead.save();

    return res.status(200).json({ lead, customer, message: 'Lead converted to customer.' });
  } catch (error) {
    console.error('Convert lead error:', error);
    return res.status(500).json({ message: 'Server error converting lead.' });
  }
};
