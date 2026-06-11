const mongoose = require('mongoose');
const Lead = require('../models/Lead');
const Customer = require('../models/Customer');
const User = require('../models/User');
const Role = require('../models/Role');
const { createLog } = require('../utils/logger');
const {
  SALES_PERSON_ROLE_VARIANTS,
  isSalesPersonRole,
  isSalesManagerRole,
} = require('../constants/userRoles');
const {
  LEAD_SOURCES,
  LEAD_SOURCE_CODE_LIST,
  resolveLeadSourceCode,
  getLeadSourceName,
} = require('../constants/leadSources');
const {
  normalizeNotes,
  attachBusinessCardsToContactInfo,
  appendBusinessCardsToContactInfo,
  resolveContactBusinessCardUploads,
} = require('../utils/subdocumentHelpers');

const ALLOWED_STATUSES = ['New', 'Assigned', 'In Progress', 'Lost Leads', 'Converted To Customer'];

const resolveSalesPerson = async (salesPersonId) => {
  if (!salesPersonId || !mongoose.Types.ObjectId.isValid(salesPersonId)) {
    return { error: 'Valid salesPersonId (or sales_person_user_id) is required.' };
  }
  const user = await User.findById(salesPersonId);
  if (!user) {
    return { error: 'Sales person not found.' };
  }
  if (!isSalesPersonRole(user.userRole)) {
    return { error: 'Selected user is not a sales person.' };
  }
  return { user };
};

const formatLeadId = (sourceCode, date, sequence) => {
  const yy = String(date.getFullYear()).slice(-2);
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const seq = String(sequence).padStart(3, '0');
  return `${sourceCode}/${yy}${mm}/${dd}${seq}`;
};

const getNextLeadId = async (leadSource, date = new Date()) => {
  const sourceCode = resolveLeadSourceCode(leadSource);
  if (!sourceCode) return null;

  const yy = String(date.getFullYear()).slice(-2);
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const idPrefix = `${sourceCode}/${yy}${mm}/${dd}`;
  const escapedPrefix = idPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  const latest = await Lead.findOne({ lead_id: new RegExp(`^${escapedPrefix}\\d{3}$`) })
    .sort({ lead_id: -1 })
    .select('lead_id')
    .lean();

  let nextSequence = 1;
  if (latest?.lead_id) {
    const suffix = latest.lead_id.slice(idPrefix.length);
    const parsed = parseInt(suffix, 10);
    if (!Number.isNaN(parsed)) nextSequence = parsed + 1;
  }

  return formatLeadId(sourceCode, date, nextSequence);
};

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

const normalizeBillFilenames = (value) => {
  if (!value) return [];
  const parsed = tryParseJson(value);
  if (Array.isArray(parsed)) {
    return parsed.map((f) => String(f).trim()).filter(Boolean);
  }
  if (typeof parsed === 'string' && parsed.trim()) {
    return [parsed.trim()];
  }
  return [];
};

const parseBillDate = (value) => {
  if (value === undefined || value === null || value === '') return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const formatLeadResponse = (leadObj) => {
  leadObj.uploadElectricityBill = normalizeBillFilenames(leadObj.uploadElectricityBill);
  if (leadObj.leadSource) {
    leadObj.leadSourceName = getLeadSourceName(leadObj.leadSource);
  }
  return leadObj;
};

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

function formatLeadForUserList(lead) {
  const leadObj = formatLeadResponse(lead.toObject ? lead.toObject() : { ...lead });
  const salesPersonUser =
    leadObj.user_id && typeof leadObj.user_id === 'object' ? leadObj.user_id : null;
  const assignedByUser =
    leadObj.assignedBy && typeof leadObj.assignedBy === 'object' ? leadObj.assignedBy : null;

  return {
    ...leadObj,
    salesPerson: mapUserSummary(salesPersonUser),
    salesPersonName: salesPersonUser?.fullName || '',
    assignedBy: mapUserSummary(assignedByUser),
    assignedByName: assignedByUser?.fullName || '',
  };
}

async function getTeamMemberIds(managerId) {
  const teamMembers = await User.find({ reportsTo: managerId }).select('_id').lean();
  return teamMembers.map((member) => member._id);
}

const resolveNewBillFilenames = (req, uploadElectricityBill, upload_electricity_bill) => {
  const billFieldNames = new Set(['upload_electricity_bill', 'uploadElectricityBill']);
  const fromFiles = (req.files && Array.isArray(req.files) ? req.files : [])
    .filter((f) => billFieldNames.has(f.fieldname))
    .map((f) => f.filename);
  const fromBody = [
    ...normalizeBillFilenames(uploadElectricityBill),
    ...normalizeBillFilenames(upload_electricity_bill),
  ];
  return [...new Set([...fromFiles, ...fromBody])];
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
        businessCard: normalizeBillFilenames(c.businessCard ?? c.bussinessCard),
        ...(c.createdAt ? { createdAt: new Date(c.createdAt) } : {}),
      };
    });
};

const normalizeLeadActivityLog = (activityLog) => {
  if (activityLog === undefined || activityLog === null) return [];
  const parsed = tryParseJson(activityLog);
  if (!Array.isArray(parsed)) return [];

  return parsed
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null;

      const activityType = (entry.activityType ?? '').toString().trim();
      if (!activityType) return null;

      const noteText = (entry.note ?? '').toString().trim();
      const notesText = (entry.notes ?? '').toString().trim();
      const outcomeText = (entry.outcome ?? '').toString().trim();
      const note =
        noteText ||
        [outcomeText, notesText].filter(Boolean).join(' — ') ||
        '';

      return {
        activityType,
        location: (entry.location ?? '').toString().trim(),
        date: entry.date ? new Date(entry.date) : new Date(),
        time: (entry.time ?? entry.timeSlot ?? '').toString().trim(),
        note,
        createdAt: entry.createdAt ? new Date(entry.createdAt) : new Date(),
      };
    })
    .filter(Boolean);
};

function formatLeadNote(note) {
  const plain = note?.toObject ? note.toObject() : { ...note };
  return {
    _id: plain._id,
    title: plain.title || '',
    note: plain.note || '',
    createdAt: plain.createdAt,
  };
}

function formatLeadActivity(activity) {
  const plain = activity?.toObject ? activity.toObject() : { ...activity };
  return {
    _id: plain._id,
    activityType: plain.activityType || '',
    location: plain.location || '',
    date: plain.date || plain.createdAt || null,
    time: plain.time || plain.timeSlot || '',
    note: plain.note || plain.notes || plain.outcome || '',
    createdAt: plain.createdAt,
  };
}

async function resolveCurrentUser(userId) {
  const Admin = require('../models/Admin');
  let currentUser = await User.findById(userId);
  let is_admin = false;

  if (!currentUser) {
    currentUser = await Admin.findById(userId);
    is_admin = !!currentUser;
  }

  if (!currentUser) {
    return { error: 'Invalid token or user not found.' };
  }

  return { currentUser, is_admin };
}

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
      billDate,
      mobileNumber,
      mobile,
      phone,
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
      lastActivity,
      notes,
      activityLog,
    } = req.body;

    const resolvedUser = await resolveCurrentUser(req.user.id);
    if (resolvedUser.error) {
      return res.status(401).json({ message: resolvedUser.error });
    }
    const { currentUser, is_admin } = resolvedUser;

    if (status && !ALLOWED_STATUSES.includes(status)) {
      return res.status(400).json({
        message: `Invalid status. Allowed values: ${ALLOWED_STATUSES.join(', ')}`,
      });
    }

    const hasAddressesField = addresses !== undefined || address !== undefined;
    const hasContactInfoField = contactInfo !== undefined || contact_info !== undefined;
    const processedAddresses = normalizeAddresses(addresses ?? address);
    const processedContactInfo = normalizeContactInfo(contactInfo ?? contact_info);
    const businessCardUploads = resolveContactBusinessCardUploads(req);

    const newBillFilenames = resolveNewBillFilenames(
      req,
      uploadElectricityBill,
      upload_electricity_bill
    );

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
      if (newBillFilenames.length > 0) {
        const existingBills = normalizeBillFilenames(lead.uploadElectricityBill);
        lead.uploadElectricityBill = [...existingBills, ...newBillFilenames];
      }
      if (billDate !== undefined) {
        lead.billDate = parseBillDate(billDate);
      }

      if (mobileNumber !== undefined) lead.mobileNumber = mobileNumber;
      if (mobile !== undefined) lead.mobileNumber = mobile;
      if (phone !== undefined) lead.phone = phone === null ? '' : String(phone).trim();
      if (email !== undefined) lead.email = email ? email.toLowerCase() : '';
      if (leadSource !== undefined) {
        const leadSourceCode = resolveLeadSourceCode(leadSource);
        if (leadSource && !leadSourceCode) {
          return res.status(400).json({
            message: `Invalid leadSource. Send a code (e.g. WB) or name (e.g. Website) from GET /api/lead-sources.`,
          });
        }
        lead.leadSource = leadSourceCode || '';
      }

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
        lead.contactInfo = appendBusinessCardsToContactInfo(lead.contactInfo, businessCardUploads);
        lead.markModified('contactInfo');
      } else if (Object.keys(businessCardUploads).length > 0) {
        lead.contactInfo = appendBusinessCardsToContactInfo(lead.contactInfo, businessCardUploads);
        lead.markModified('contactInfo');
      }

      if (notes !== undefined) {
        const processedNotes = normalizeNotes(notes).filter((item) => item.note || item.title);
        if (processedNotes.length) {
          lead.notes = [...(lead.notes || []), ...processedNotes];
          lead.markModified('notes');
        }
      }

      if (activityLog !== undefined) {
        const processedActivityLog = normalizeLeadActivityLog(activityLog);
        if (processedActivityLog.length) {
          lead.activityLog = [...(lead.activityLog || []), ...processedActivityLog];
          lead.markModified('activityLog');
          lead.lastActivity = new Date();
        }
      }

      const updatedLead = await lead.save();

      await createLog(`Lead Updated`, req.user.id, name, 'Lead', updatedLead._id);

      const updatedObj = formatLeadResponse(updatedLead.toObject());
      return res.status(200).json({ lead: updatedObj, message: 'Lead updated successfully.' });
    } else {
      // CREATE RECORD
      const leadSourceCode = resolveLeadSourceCode(leadSource);
      if (!leadSourceCode) {
        return res.status(400).json({
          message:
            'Invalid or missing leadSource. Send a code (e.g. CA) or name (e.g. Company Appointment) from GET /api/lead-sources.',
        });
      }

      const salesPersonId = req.body.salesPersonId || req.body.sales_person_user_id;
      let assignedSalesPerson = null;
      if (salesPersonId) {
        const resolved = await resolveSalesPerson(salesPersonId);
        if (resolved.error) {
          return res.status(400).json({ message: resolved.error });
        }
        assignedSalesPerson = resolved.user;
      }

      const isAssigningToSalesPerson =
        assignedSalesPerson && String(assignedSalesPerson._id) !== String(currentUser._id);

      const initialStatus = isAssigningToSalesPerson
        ? 'Assigned'
        : status || 'New';

      if (status && !ALLOWED_STATUSES.includes(status)) {
        return res.status(400).json({
          message: `Invalid status. Allowed values: ${ALLOWED_STATUSES.join(', ')}`,
        });
      }

      const processedNotes = normalizeNotes(notes).filter((item) => item.note || item.title);
      const processedActivityLog = normalizeLeadActivityLog(activityLog);
      const latestActivityDate = processedActivityLog.reduce((latest, entry) => {
        const entryDate = entry.date ? new Date(entry.date).getTime() : 0;
        return entryDate > latest ? entryDate : latest;
      }, 0);

      const leadData = {
        leadName: leadName ?? '',
        name,
        company,
        dba: dba || '',
        legalName: legalName || '',
        accountNumber: accountNumber || '',
        electricCompany: electricCompany || electric_company || '',
        uploadElectricityBill: newBillFilenames,
        billDate: parseBillDate(billDate),
        mobileNumber: mobileNumber || mobile || '',
        phone: phone ? String(phone).trim() : '',
        email: email ? email.toLowerCase() : '',
        leadSource: leadSourceCode,
        addresses: processedAddresses || [],
        contactInfo: attachBusinessCardsToContactInfo(
          processedContactInfo || [],
          businessCardUploads
        ),
        street: street || '',
        city: city || '',
        state: state || '',
        zip: zip || '',
        notes: processedNotes,
        activityLog: processedActivityLog,
        user_id: assignedSalesPerson ? assignedSalesPerson._id : currentUser._id,
        ...(isAssigningToSalesPerson
          ? { assignedBy: currentUser._id, assignedAt: new Date() }
          : {}),
        createdByName: is_admin ? currentUser.email : currentUser.fullName,
        createdByEmail: currentUser.email,
        createdByRole: is_admin ? 'admin' : currentUser.userRole,
        lastActivity: lastActivity
          ? new Date(lastActivity)
          : latestActivityDate
            ? new Date(latestActivityDate)
            : Date.now(),
        status: isAssigningToSalesPerson ? 'Assigned' : initialStatus,
        convertedToCustomer: initialStatus === 'Converted To Customer',
      };

      let lead;
      for (let attempt = 0; attempt < 5; attempt++) {
        const lead_id = await getNextLeadId(leadSourceCode);
        try {
          lead = await Lead.create({ ...leadData, lead_id });
          break;
        } catch (err) {
          if (err.code === 11000 && err.keyPattern?.lead_id && attempt < 4) continue;
          throw err;
        }
      }

      if (!lead) {
        return res.status(500).json({ message: 'Could not generate a unique lead_id.' });
      }

      const leadObj = formatLeadResponse(lead.toObject());
      return res.status(201).json({ lead: leadObj, message: 'Lead created successfully.' });
    }
  } catch (error) {
    console.error('Save lead error:', error);
    return res.status(500).json({ message: 'Server error saving lead.', error: error.message });
  }
};

exports.addLeadNote = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, note } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Valid lead id is required.' });
    }

    const noteText = (note ?? '').toString().trim();
    if (!noteText) {
      return res.status(400).json({ message: 'note is required.' });
    }

    const resolvedUser = await resolveCurrentUser(req.user.id);
    if (resolvedUser.error) {
      return res.status(401).json({ message: resolvedUser.error });
    }

    const lead = await Lead.findById(id);
    if (!lead) {
      return res.status(404).json({ message: 'Lead not found.' });
    }

    const noteEntry = {
      title: (title ?? '').toString().trim(),
      note: noteText,
      createdAt: new Date(),
    };

    lead.notes = [...(lead.notes || []), noteEntry];
    lead.lastActivity = new Date();
    lead.markModified('notes');
    await lead.save();

    const savedNote = lead.notes[lead.notes.length - 1];

    await createLog('Lead Note Added', req.user.id, lead.name || lead.leadName || 'Lead', 'Lead', lead._id);

    return res.status(201).json({
      message: 'Lead note added successfully.',
      note: formatLeadNote(savedNote),
      notes: lead.notes.map(formatLeadNote),
    });
  } catch (error) {
    console.error('Add lead note error:', error);
    return res.status(500).json({ message: 'Server error adding lead note.' });
  }
};

exports.getLeadNotes = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Valid lead id is required.' });
    }

    const lead = await Lead.findById(id).select('notes name leadName');
    if (!lead) {
      return res.status(404).json({ message: 'Lead not found.' });
    }

    const notes = [...(lead.notes || [])]
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .map(formatLeadNote);

    return res.status(200).json({
      leadId: id,
      notes,
      total: notes.length,
    });
  } catch (error) {
    console.error('Get lead notes error:', error);
    return res.status(500).json({ message: 'Server error fetching lead notes.' });
  }
};

exports.addLeadActivity = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      activityType,
      location,
      date,
      time,
      timeSlot,
      note,
      notes,
    } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Valid lead id is required.' });
    }

    if (!activityType) {
      return res.status(400).json({ message: 'activityType is required.' });
    }

    const resolvedUser = await resolveCurrentUser(req.user.id);
    if (resolvedUser.error) {
      return res.status(401).json({ message: resolvedUser.error });
    }

    const lead = await Lead.findById(id);
    if (!lead) {
      return res.status(404).json({ message: 'Lead not found.' });
    }

    const activityEntry = {
      activityType: activityType.toString().trim(),
      location: (location ?? '').toString().trim(),
      date: date ? new Date(date) : new Date(),
      time: (time ?? timeSlot ?? '').toString().trim(),
      note: (note ?? notes ?? '').toString().trim(),
      createdAt: new Date(),
    };

    lead.activityLog = [...(lead.activityLog || []), activityEntry];
    lead.lastActivity = new Date();
    lead.markModified('activityLog');
    await lead.save();

    const savedActivity = lead.activityLog[lead.activityLog.length - 1];

    await createLog(
      `Lead Activity: ${activityEntry.activityType}`,
      req.user.id,
      lead.name || lead.leadName || 'Lead',
      'Lead',
      lead._id
    );

    return res.status(201).json({
      message: 'Lead activity recorded successfully.',
      activity: formatLeadActivity(savedActivity),
      activities: lead.activityLog.map(formatLeadActivity),
    });
  } catch (error) {
    console.error('Add lead activity error:', error);
    return res.status(500).json({ message: 'Server error recording lead activity.' });
  }
};

exports.getLeadActivities = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Valid lead id is required.' });
    }

    const lead = await Lead.findById(id).select('activityLog name leadName');
    if (!lead) {
      return res.status(404).json({ message: 'Lead not found.' });
    }

    const activities = [...(lead.activityLog || [])]
      .sort((a, b) => new Date(b.date || b.createdAt) - new Date(a.date || a.createdAt))
      .map(formatLeadActivity);

    return res.status(200).json({
      leadId: id,
      activities,
      total: activities.length,
    });
  } catch (error) {
    console.error('Get lead activities error:', error);
    return res.status(500).json({ message: 'Server error fetching lead activities.' });
  }
};

exports.getLeadSources = (req, res) => {
  return res.status(200).json({ leadSources: LEAD_SOURCES });
};

exports.listSalesPersons = async (req, res) => {
  try {
    const role = await Role.findOne({ roleName: 'Sales Person' });
    const orClauses = [{ userRole: { $in: SALES_PERSON_ROLE_VARIANTS } }];
    if (role) orClauses.push({ roleId: role._id });

    const filter = { $or: orClauses };
    const currentUser = await User.findById(req.user.id).select('userRole').lean();
    if (currentUser && isSalesManagerRole(currentUser.userRole)) {
      filter.reportsTo = req.user.id;
    }

    const users = await User.find(filter)
      .select('fullName email mobileNumber company status userRole reportsTo')
      .sort({ fullName: 1 })
      .lean();

    const salesPersons = users.map((u) => ({
      id: u._id,
      fullName: u.fullName,
      email: u.email || '',
      mobileNumber: u.mobileNumber || '',
      company: u.company || '',
      status: u.status || '',
      userRole: u.userRole,
    }));

    return res.status(200).json({
      salesPersons,
      count: salesPersons.length,
    });
  } catch (error) {
    console.error('List sales persons error:', error);
    return res.status(500).json({ message: 'Server error listing sales persons.' });
  }
};

exports.assignLeadToSalesPerson = async (req, res) => {
  try {
    const { id } = req.params;
    const salesPersonId = req.body.salesPersonId || req.body.sales_person_user_id;

    const resolved = await resolveSalesPerson(salesPersonId);
    if (resolved.error) {
      return res.status(400).json({ message: resolved.error });
    }
    const salesPerson = resolved.user;

    const lead = await Lead.findById(id);
    if (!lead) {
      return res.status(404).json({ message: 'Lead not found.' });
    }

    if (lead.status === 'Converted To Customer') {
      return res.status(400).json({
        message: 'Cannot reassign a lead that is already converted to customer.',
      });
    }

    const assigner = await User.findById(req.user.id);
    const assignerName = assigner?.fullName || assigner?.email || 'Manager';

    if (isSalesManagerRole(assigner?.userRole)) {
      const reportsToId = salesPerson.reportsTo?.toString?.() || String(salesPerson.reportsTo || '');
      if (reportsToId !== req.user.id.toString()) {
        return res.status(403).json({
          message: 'You can only assign leads to sales persons on your team.',
        });
      }
    }

    lead.user_id = salesPerson._id;
    lead.assignedBy = req.user.id;
    lead.assignedAt = new Date();
    lead.status = 'Assigned';
    lead.lastActivity = new Date();
    lead.activityLog.push({
      activityType: 'Assignment',
      location: '',
      date: new Date(),
      time: '',
      note: `Assigned to ${salesPerson.fullName} by ${assignerName}`,
      createdAt: new Date(),
    });
    lead.markModified('activityLog');

    await lead.save();

    await createLog(
      'Lead Assigned',
      req.user.id,
      `${lead.name || lead.leadName} → ${salesPerson.fullName}`,
      'Lead',
      lead._id
    );

    const leadObj = formatLeadResponse(
      (await Lead.findById(lead._id).populate('user_id', 'fullName email').populate('assignedBy', 'fullName email')).toObject()
    );

    return res.status(200).json({
      message: 'Lead assigned to sales person successfully.',
      lead: leadObj,
    });
  } catch (error) {
    console.error('Assign lead error:', error);
    return res.status(500).json({ message: 'Server error assigning lead.' });
  }
};

const mapLeadToSummary = (lead) => ({
  id: lead._id,
  lead_id: lead.lead_id || '',
  leadName: lead.leadName,
  name: lead.name,
  company: lead.company,
  dba: lead.dba,
  legalName: lead.legalName,
  accountNumber: lead.accountNumber,
  electricCompany: lead.electricCompany,
  uploadElectricityBill: normalizeBillFilenames(lead.uploadElectricityBill),
  billDate: lead.billDate || null,
  mobileNumber: lead.mobileNumber,
  phone: lead.phone || '',
  email: lead.email,
  leadSource: lead.leadSource,
  leadSourceName: getLeadSourceName(lead.leadSource),
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
  lostReason: lead.lostReason || '',
  user_id: lead.user_id?._id || lead.user_id,
  salesPersonName: lead.user_id?.fullName || '',
  assignedBy: lead.assignedBy?._id || lead.assignedBy || null,
  assignedByName: lead.assignedBy?.fullName || '',
  assignedAt: lead.assignedAt || null,
  createdByName: lead.createdByName,
});

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

    const leads = await Lead.find(filter)
      .sort({ createdAt: -1 })
      .populate('user_id', 'fullName email')
      .populate('assignedBy', 'fullName email');

    const leadSummaries = leads.map((lead) => mapLeadToSummary(lead));

    return res.status(200).json({ leads: leadSummaries });
  } catch (error) {
    console.error('List leads error:', error);
    return res.status(500).json({ message: 'Server error listing leads.' });
  }
};

exports.getLead = async (req, res) => {
  try {
    const { id } = req.params;
    const lead = await Lead.findById(id)
      .populate('user_id', 'fullName email')
      .populate('assignedBy', 'fullName email');

    if (!lead) {
      return res.status(404).json({ message: 'Lead not found.' });
    }

    const leadObj = formatLeadResponse(lead.toObject());
    return res.status(200).json({ lead: leadObj });
  } catch (error) {
    console.error('Get lead error:', error);
    return res.status(500).json({ message: 'Server error fetching lead.' });
  }
};

const mapLeadNotesForCustomer = (leadNotes) => {
  if (!Array.isArray(leadNotes)) return [];
  return leadNotes
    .map((n) => {
      const noteText = (n?.note ?? '').toString().trim();
      const title = (n?.title ?? '').toString().trim();
      if (!noteText && !title) return null;
      return {
        title,
        note: noteText || title,
        createdAt: n?.createdAt || new Date(),
      };
    })
    .filter(Boolean);
};

const buildCustomerPayloadFromLead = (lead, userId) => {
  const leadObj = lead.toObject ? lead.toObject() : lead;

  return {
    leadId: leadObj._id,
    user_id: leadObj.user_id || userId,
    name: leadObj.name || leadObj.leadName || '',
    legalName: leadObj.legalName || '',
    ...(leadObj.accountNumber ? { accountNumber: leadObj.accountNumber } : {}),
    company: leadObj.company || '',
    uploadElectricityBill: normalizeBillFilenames(leadObj.uploadElectricityBill),
    mobileNumber: leadObj.mobileNumber || '',
    phone: leadObj.phone || '',
    billDate: leadObj.billDate || null,
    email: leadObj.email || '',
    leadSource: leadObj.leadSource || '',
    address: {
      street: leadObj.street || '',
      city: leadObj.city || '',
      state: leadObj.state || '',
      zip: leadObj.zip || '',
    },
    addresses: toPlainSubdocs(leadObj.addresses),
    contactInfo: toPlainSubdocs(leadObj.contactInfo),
    notes: mapLeadNotesForCustomer(leadObj.notes),
    convertedDate: new Date(),
    lastActivity: leadObj.lastActivity || new Date(),
    status: 'New',
  };
};

exports.convertToCustomer = async (req, res) => {
  try {
    const { id } = req.params;
    const lead = await Lead.findById(id);

    if (!lead) {
      return res.status(404).json({ message: 'Lead not found.' });
    }

    const customerPayload = buildCustomerPayloadFromLead(lead, req.user.id);

    let customer = await Customer.findOne({ leadId: lead._id });
    if (!customer) {
      customer = await Customer.create(customerPayload);
    } else {
      Object.assign(customer, customerPayload);
      await customer.save();
    }

    lead.status = 'Converted To Customer';
    lead.convertedToCustomer = true;
    lead.activityLog.push({
      activityType: 'Conversion',
      location: '',
      date: new Date(),
      time: '',
      note: 'Lead converted to customer',
      createdAt: new Date(),
    });
    await lead.save();

    await createLog('Lead Converted to Customer', req.user.id, lead.name, 'Customer', customer._id);

    return res.status(200).json({ lead, customer, message: 'Lead converted to customer.' });
  } catch (error) {
    console.error('Convert lead error:', error);
    return res.status(500).json({ message: 'Server error converting lead.' });
  }
};

exports.markLeadAsLost = async (req, res) => {
  try {
    const { id } = req.params;
    const reason =
      req.body.reason !== undefined && req.body.reason !== null
        ? String(req.body.reason).trim()
        : '';

    const lead = await Lead.findById(id);
    if (!lead) {
      return res.status(404).json({ message: 'Lead not found.' });
    }

    if (lead.status === 'Converted To Customer') {
      return res.status(400).json({
        message: 'Cannot mark a converted lead as lost.',
      });
    }

    lead.status = 'Lost Leads';
    lead.convertedToCustomer = false;
    lead.lostReason = reason;
    lead.lastActivity = new Date();
    lead.activityLog.push({
      activityType: 'Lost Lead',
      location: '',
      date: new Date(),
      time: '',
      note: reason || 'Lead marked as lost',
      createdAt: new Date(),
    });

    await lead.save();
    await createLog('Lead Marked as Lost', req.user.id, lead.name, 'Lead', lead._id);

    const leadObj = formatLeadResponse(lead.toObject());
    return res.status(200).json({
      message: 'Lead marked as lost successfully.',
      lead: leadObj,
    });
  } catch (error) {
    console.error('Mark lead as lost error:', error);
    return res.status(500).json({ message: 'Server error marking lead as lost.' });
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
            location: '',
            date: new Date(),
            time: '',
            note: `Lead status updated to ${status}`,
            createdAt: new Date(),
          },
        },
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

    const user = await User.findById(userId).select('userRole').lean();
    if (!user) {
      return res.status(401).json({ message: 'Invalid authenticated user.' });
    }

    const { status, salesPersonId, salesPerson } = req.query;
    const filterSalesPersonId = salesPersonId || salesPerson;
    const leadFilter = {};

    if (isSalesManagerRole(user.userRole)) {
      const teamMemberIds = await getTeamMemberIds(userId);
      const visibleUserIds = [
        ...teamMemberIds,
        new mongoose.Types.ObjectId(userId),
      ];

      if (filterSalesPersonId) {
        if (!mongoose.Types.ObjectId.isValid(filterSalesPersonId)) {
          return res.status(400).json({ message: 'Invalid salesPersonId.' });
        }
        const isSelf = filterSalesPersonId.toString() === userId.toString();
        const isOnTeam = teamMemberIds.some(
          (id) => id.toString() === filterSalesPersonId.toString()
        );
        if (!isSelf && !isOnTeam) {
          return res.status(403).json({
            message: 'Sales person is not on your team.',
          });
        }
        leadFilter.user_id = filterSalesPersonId;
      } else {
        leadFilter.user_id = { $in: visibleUserIds };
      }
    } else {
      leadFilter.user_id = userId;
    }

    if (status) {
      if (!ALLOWED_STATUSES.includes(status)) {
        return res.status(400).json({
          message: `Invalid status. Allowed values: ${ALLOWED_STATUSES.join(', ')}`,
        });
      }
      leadFilter.status = status;
    }

    const leads = await Lead.find(leadFilter)
      .sort({ createdAt: -1 })
      .populate('user_id', 'fullName email mobileNumber userRole')
      .populate('assignedBy', 'fullName email mobileNumber userRole');

    const formattedLeads = leads.map((lead) => formatLeadForUserList(lead));

    return res.status(200).json({
      leads: formattedLeads,
      total: formattedLeads.length,
    });
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
            location: '',
            date: new Date(),
            time: '',
            note: `Lead status updated to ${status}`,
            createdAt: new Date(),
          },
        },
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
