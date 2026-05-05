const Lead = require('../models/Lead');
const Customer = require('../models/Customer');
const User = require('../models/User');
const { createLog } = require('../utils/logger');

const ALLOWED_STATUSES = ['New', 'In Progress', 'Lost Leads', 'Converted To Customer'];

exports.createLead = async (req, res) => {
  try {
    const {
      id,
      name,
      company,
      mobileNumber,
      email,
      leadSource,
      status,
      street,
      city,
      state,
      zip,
      notes,
      lastActivity,
      activityLog,
      activityType,
      activityDate,
      outcome,
      nextFollowUpDate,
      followUpDate
    } = req.body;

    const Admin = require('../models/Admin');
    let currentUser = await User.findById(req.user.id);
    let is_admin = false;

    if (!currentUser) {
      currentUser = await Admin.findById(req.user.id);
      is_admin = !!currentUser;
    }

    if (!currentUser) {
      return res.status(401).json({ message: 'Invalid token or user not found.' });
    }

    if (!name || !company || !mobileNumber) {
      return res.status(400).json({ message: 'name, company, mobileNumber are required.' });
    }

    if (status && !ALLOWED_STATUSES.includes(status)) {
      return res.status(400).json({
        message: `Invalid status. Allowed values: ${ALLOWED_STATUSES.join(', ')}`,
      });
    }

    // Process notes
    let processedNotes = [];
    if (notes) {
      if (Array.isArray(notes)) {
        processedNotes = notes.map(n => {
          const noteText = typeof n === 'string' ? n : (n.note || '');
          return { note: noteText, createdAt: new Date() };
        });
      } else {
        processedNotes = [{ note: notes, createdAt: new Date() }];
      }
    }

    // Process activity log
    let processedActivityLog = [];
    if (activityLog && Array.isArray(activityLog)) {
      processedActivityLog = activityLog.map(a => ({
        activityType: a.activityType,
        date: a.date ? new Date(a.date) : new Date(),
        outcome: a.outcome || '',
        notes: a.notes || '',
        followUpDate: a.followUpDate ? new Date(a.followUpDate) : undefined,
        nextFollowUpDate: a.nextFollowUpDate ? new Date(a.nextFollowUpDate) : undefined,
        createdAt: new Date()
      }));
    } else if (activityType) {
      processedActivityLog = [{
        activityType,
        date: activityDate ? new Date(activityDate) : new Date(),
        outcome: outcome || '',
        notes: typeof notes === 'string' ? notes : '',
        followUpDate: followUpDate ? new Date(followUpDate) : undefined,
        nextFollowUpDate: nextFollowUpDate ? new Date(nextFollowUpDate) : undefined,
        createdAt: new Date()
      }];
    }

    if (id) {
      // UPDATE RECORD
      const lead = await Lead.findById(id);
      if (!lead) {
        return res.status(404).json({ message: 'Lead not found.' });
      }

      // Update basic fields
      lead.name = name;
      lead.company = company;
      lead.mobileNumber = mobileNumber;
      lead.email = email ? email.toLowerCase() : '';
      lead.leadSource = leadSource || '';
      lead.street = street || '';
      lead.city = city || '';
      lead.state = state || '';
      lead.zip = zip || '';
      lead.lastActivity = lastActivity ? new Date(lastActivity) : Date.now();
      if (status) {
        lead.status = status;
        lead.convertedToCustomer = status === 'Converted To Customer';
      }

      // Handle notes safely (force $set by reassigning the whole array)
      let currentNotes = Array.isArray(lead.notes) ? lead.notes : [];
      if (!Array.isArray(lead.notes) && typeof lead.notes === 'string' && lead.notes) {
        currentNotes = [{ note: lead.notes, createdAt: lead.updatedAt || new Date() }];
      }

      // Repair logic: Fix cases where a string was accidentally stored as an object with numeric keys
      currentNotes = currentNotes.map(n => {
        if (n && typeof n === 'object' && !n.note && n[0] !== undefined) {
          let reconstructedNote = '';
          for (let i = 0; n[i] !== undefined; i++) {
            reconstructedNote += n[i];
          }
          return { note: reconstructedNote, createdAt: n.createdAt || new Date() };
        }
        return n;
      });

      if (processedNotes.length > 0) {
        lead.notes = [...currentNotes, ...processedNotes];
        lead.markModified('notes');
      } else {
        lead.notes = currentNotes;
      }

      // Handle activity log safely (force $set by reassigning the whole array)
      let currentActivityLog = Array.isArray(lead.activityLog) ? lead.activityLog : [];

      if (processedActivityLog.length > 0) {
        lead.activityLog = [...currentActivityLog, ...processedActivityLog];
      } else {
        lead.activityLog = [...currentActivityLog, {
          activityType: 'Update',
          date: new Date(),
          outcome: 'Lead details updated',
          createdAt: new Date()
        }];
      }
      lead.markModified('activityLog');

      const updatedLead = await lead.save();

      await createLog(`Lead Updated`, req.user.id, name, 'Lead', updatedLead._id);

      return res.status(200).json({ lead: updatedLead, message: 'Lead updated successfully.' });
    } else {
      // CREATE RECORD
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
        notes: processedNotes,
        activityLog: processedActivityLog.length > 0 ? processedActivityLog : [{
          activityType: 'Creation',
          date: new Date(),
          outcome: 'Lead Created',
          createdAt: new Date()
        }],
        user_id: currentUser._id,
        createdByName: is_admin ? currentUser.email : currentUser.fullName,
        createdByEmail: currentUser.email,
        createdByRole: is_admin ? 'admin' : currentUser.userRole,
        lastActivity: lastActivity ? new Date(lastActivity) : Date.now(),
        status: status || 'New',
        convertedToCustomer: status === 'Converted To Customer',
      });

      await createLog('Lead Created', req.user.id, name, 'Lead', lead._id);

      return res.status(201).json({ lead, message: 'Lead created successfully.' });
    }
  } catch (error) {
    console.error('Save lead error:', error);
    return res.status(500).json({ message: 'Server error saving lead.' });
  }
};

exports.listLeads = async (req, res) => {
  try {
    const { status, salesPerson } = req.query;
    const filter = {};

    if (status) {
      if (!ALLOWED_STATUSES.includes(status)) {
        return res.status(400).json({
          message: `Invalid status. Allowed values: ${ALLOWED_STATUSES.join(', ')}`,
        });
      }
      filter.status = status;
    }

    if (salesPerson) {
      filter.user_id = salesPerson;
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
        user_id: lead.user_id || req.user.id,
        name: lead.name,
        company: lead.company,
        mobileNumber: lead.mobileNumber,
        email: lead.email,
        leadSource: lead.leadSource,
        convertedDate: new Date(),
        lastActivity: lead.lastActivity,
        status: 'New',
        address: {
          street: lead.street,
          city: lead.city,
          state: lead.state,
          zip: lead.zip,
        },
        notes: lead.notes || [],
        activityLog: lead.activityLog,
      });
    }

    lead.status = 'Converted To Customer';
    lead.convertedToCustomer = true;
    lead.activityLog.push({
      activityType: 'Conversion',
      outcome: 'Lead Converted to Customer',
      createdAt: new Date()
    });
    await lead.save();

    await createLog('Lead Converted to Customer', req.user.id, lead.name, 'Customer', customer._id);

    return res.status(200).json({ lead, customer, message: 'Lead converted to customer.' });
  } catch (error) {
    console.error('Convert lead error:', error);
    return res.status(500).json({ message: 'Server error converting lead.' });
  }
};

exports.updateLeadStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!status) {
      return res.status(400).json({ message: 'Status is required.' });
    }

    if (!ALLOWED_STATUSES.includes(status)) {
      return res.status(400).json({
        message: `Invalid status. Allowed values: ${ALLOWED_STATUSES.join(', ')}`,
      });
    }

    const lead = await Lead.findByIdAndUpdate(
      id,
      {
        $set: {
          status,
          convertedToCustomer: status === 'Converted To Customer'
        },
        $push: {
          activityLog: {
            activityType: 'Status Update',
            outcome: `Lead Status Updated to ${status}`,
            createdAt: new Date()
          }
        }
      },
      { new: true, runValidators: true }
    );

    if (!lead) {
      return res.status(404).json({ message: 'Lead not found.' });
    }

    await createLog(`Lead Status Updated to ${status}`, req.user.id, lead.name, 'Lead', lead._id);

    return res.status(200).json({
      message: `Lead status updated to ${status} successfully.`,
      lead,
    });
  } catch (error) {
    console.error('Update lead status error:', error);
    return res.status(500).json({ message: 'Server error updating lead status.' });
  }
};

exports.getLeadsByUser = async (req, res) => {
  try {
    const userId = req.user.id;
    if (!userId) {
      return res.status(401).json({ message: 'User not authenticated.' });
    }

    const leads = await Lead.find({ user_id: userId, status: 'New' }).sort({ createdAt: -1 });

    return res.status(200).json({ leads });
  } catch (error) {
    console.error('Get leads by user error:', error);
    return res.status(500).json({ message: 'Server error fetching leads by user.' });
  }
};

exports.updateLeadStatusById = async (req, res) => {
  try {
    const { leadId, status } = req.body;

    if (!leadId || !status) {
      return res.status(400).json({ message: 'leadId and status are required.' });
    }

    if (!ALLOWED_STATUSES.includes(status)) {
      return res.status(400).json({
        message: `Invalid status. Allowed values: ${ALLOWED_STATUSES.join(', ')}`,
      });
    }

    const lead = await Lead.findByIdAndUpdate(
      leadId,
      {
        $set: {
          status,
          convertedToCustomer: status === 'Converted To Customer'
        },
        $push: {
          activityLog: {
            activityType: 'Status Update',
            outcome: `Lead Status Updated to ${status}`,
            createdAt: new Date()
          }
        }
      },
      { new: true, runValidators: true }
    );

    if (!lead) {
      return res.status(404).json({ message: 'Lead not found.' });
    }

    await createLog(`Lead Status Updated to ${status}`, req.user.id, lead.name, 'Lead', lead._id);

    return res.status(200).json({
      message: `Lead status updated to ${status} successfully.`,
      lead,
    });
  } catch (error) {
    console.error('Update lead status by ID error:', error);
    return res.status(500).json({ message: 'Server error updating lead status.' });
  }
};
