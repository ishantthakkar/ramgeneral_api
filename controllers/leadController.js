const Lead = require('../models/Lead');
const Customer = require('../models/Customer');
const User = require('../models/User');
const { createLog } = require('../utils/logger');

const ALLOWED_STATUSES = ['New', 'In Progress', 'Lost Leads', 'Converted To Customer'];

const getBaseUrl = (req) => `${req.protocol}://${req.get('host')}`;

const tryParseJson = (value) => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed) return value;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
};

const getSubdocId = (item) => {
  if (!item) return null;
  if (item.id) return String(item.id);
  if (item._id) return String(item._id);
  return null;
};

const toPlainSubdocs = (items) =>
  (Array.isArray(items) ? items : []).map((doc) =>
    doc && typeof doc.toObject === 'function' ? doc.toObject() : { ...doc }
  );

/** Update by subdoc id when present; otherwise append as new. */
const mergeSubdocuments = (existing, incoming) => {
  const result = toPlainSubdocs(existing);

  for (const item of incoming) {
    const itemId = getSubdocId(item);
    const { id, _id, ...fields } = item;

    if (itemId) {
      const index = result.findIndex(
        (r) => String(r._id) === itemId || String(r.id) === itemId
      );
      if (index >= 0) {
        result[index] = {
          ...result[index],
          ...fields,
          _id: result[index]._id,
          createdAt: result[index].createdAt || fields.createdAt || new Date(),
        };
        continue;
      }
    }

    result.push({
      ...fields,
      createdAt: fields.createdAt || new Date(),
    });
  }

  return result;
};

const normalizeAddresses = (addresses) => {
  if (!addresses) return null;
  const parsed = tryParseJson(addresses);
  if (!Array.isArray(parsed)) return null;
  return parsed
    .filter(Boolean)
    .map((a) => {
      const subdocId = getSubdocId(a);
      return {
        ...(subdocId ? { id: subdocId } : {}),
        title: (a.title ?? a.label ?? '').toString().trim(),
        street: (a.street ?? '').toString().trim(),
        city: (a.city ?? '').toString().trim(),
        state: (a.state ?? '').toString().trim(),
        zip: (a.zip ?? '').toString().trim(),
        ...(a.createdAt ? { createdAt: new Date(a.createdAt) } : {}),
      };
    });
};

const normalizeContactInfo = (contactInfo) => {
  if (!contactInfo) return null;
  const parsed = tryParseJson(contactInfo);
  if (!Array.isArray(parsed)) return null;
  return parsed
    .filter(Boolean)
    .map((c) => {
      const subdocId = getSubdocId(c);
      return {
        ...(subdocId ? { id: subdocId } : {}),
        position: (c.position ?? '').toString().trim(),
        department: (c.department ?? '').toString().trim(),
        name: (c.name ?? '').toString().trim(),
        phone: (c.phone ?? '').toString().trim(),
        mobile: (c.mobile ?? '').toString().trim(),
        email: (c.email ?? '').toString().trim().toLowerCase(),
        ...(c.createdAt ? { createdAt: new Date(c.createdAt) } : {}),
      };
    });
};

exports.createLead = async (req, res) => {
  try {
    const {
      id,
      leadName,
      name,
      company,
      dba,
      legalName,
      accountNumber,
      electric_company,
      electricCompany,
      upload_electricity_bill,
      uploadElectricityBill,
      mobileNumber,
      mobile,
      email,
      leadSource,
      status,
      addresses,
      address,
      contactInfo,
      contact_info,
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

    const hasAddressesField = addresses !== undefined || address !== undefined;
    const hasContactInfoField = contactInfo !== undefined || contact_info !== undefined;
    const processedAddresses = normalizeAddresses(addresses ?? address);
    const processedContactInfo = normalizeContactInfo(contactInfo ?? contact_info);

    const billFilename =
      (req.file && req.file.filename) ||
      uploadElectricityBill ||
      upload_electricity_bill ||
      '';

    if (id) {
      // UPDATE RECORD
      const lead = await Lead.findById(id);
      if (!lead) {
        return res.status(404).json({ message: 'Lead not found.' });
      }

      // Update basic fields
      if (leadName !== undefined) lead.leadName = leadName;
      if (name !== undefined) lead.name = name;
      if (company !== undefined) lead.company = company;
      if (dba !== undefined) lead.dba = dba;
      if (legalName !== undefined) lead.legalName = legalName;
      if (accountNumber !== undefined) lead.accountNumber = accountNumber;
      if (electricCompany !== undefined) lead.electricCompany = electricCompany;
      if (electric_company !== undefined) lead.electricCompany = electric_company;
      if (billFilename) lead.uploadElectricityBill = billFilename;

      if (mobileNumber !== undefined) lead.mobileNumber = mobileNumber;
      if (mobile !== undefined) lead.mobileNumber = mobile;
      if (email !== undefined) lead.email = email ? email.toLowerCase() : '';
      if (leadSource !== undefined) lead.leadSource = leadSource || '';

      // Backward-compatible single address fields
      if (street !== undefined) lead.street = street || '';
      if (city !== undefined) lead.city = city || '';
      if (state !== undefined) lead.state = state || '';
      if (zip !== undefined) lead.zip = zip || '';

      if (lastActivity !== undefined) {
        lead.lastActivity = lastActivity ? new Date(lastActivity) : Date.now();
      }
      if (status) {
        lead.status = status;
        lead.convertedToCustomer = status === 'Converted To Customer';
      }

      if (hasAddressesField && processedAddresses !== null) {
        lead.addresses = mergeSubdocuments(lead.addresses, processedAddresses);
        lead.markModified('addresses');
      }

      if (hasContactInfoField && processedContactInfo !== null) {
        lead.contactInfo = mergeSubdocuments(lead.contactInfo, processedContactInfo);
        lead.markModified('contactInfo');
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

      const updatedObj = updatedLead.toObject();
      if (updatedObj.uploadElectricityBill) {
        updatedObj.uploadElectricityBillUrl = `${getBaseUrl(req)}/uploads/leads/bills/${updatedObj.uploadElectricityBill}`;
      }
      return res.status(200).json({ lead: updatedObj, message: 'Lead updated successfully.' });
    } else {
      // CREATE RECORD
      const lead = await Lead.create({
        leadName: leadName ?? '',
        name,
        company,
        dba: dba || '',
        legalName: legalName || '',
        accountNumber: accountNumber || '',
        electricCompany: electricCompany || electric_company || '',
        uploadElectricityBill: billFilename || '',
        mobileNumber: mobileNumber || mobile || '',
        email: email ? email.toLowerCase() : '',
        leadSource: leadSource || '',
        addresses: processedAddresses || [],
        contactInfo: processedContactInfo || [],
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

      const leadObj = lead.toObject();
      if (leadObj.uploadElectricityBill) {
        leadObj.uploadElectricityBillUrl = `${getBaseUrl(req)}/uploads/leads/bills/${leadObj.uploadElectricityBill}`;
      }
      return res.status(201).json({ lead: leadObj, message: 'Lead created successfully.' });
    }
  } catch (error) {
    console.error('Save lead error:', error);
    return res.status(500).json({ message: 'Server error saving lead.', error: error.message });
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
    const baseUrl = getBaseUrl(req);
    const leadSummaries = leads.map((lead) => ({
      id: lead._id,
      leadName: lead.leadName,
      name: lead.name,
      company: lead.company,
      dba: lead.dba,
      legalName: lead.legalName,
      accountNumber: lead.accountNumber,
      electricCompany: lead.electricCompany,
      uploadElectricityBill: lead.uploadElectricityBill,
      uploadElectricityBillUrl: lead.uploadElectricityBill
        ? `${baseUrl}/uploads/leads/bills/${lead.uploadElectricityBill}`
        : '',
      mobileNumber: lead.mobileNumber,
      email: lead.email,
      leadSource: lead.leadSource,
      addresses: lead.addresses || [],
      contactInfo: lead.contactInfo || [],
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
    const lead = await Lead.findById(id).populate("user_id", "fullName");

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

    const leads = await Lead.find({ user_id: userId }).sort({ createdAt: -1 });

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
