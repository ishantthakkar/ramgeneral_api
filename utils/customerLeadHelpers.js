const Lead = require('../models/Lead');
const CustomerActivity = require('../models/CustomerActivity');

const LEAD_FIELDS_FOR_POPULATE =
  'lead_id leadName name dba legalName electricCompany createdByName createdByEmail createdByRole';

const CUSTOMER_ACTIVITY_TYPES = CustomerActivity.schema.path('activityType').enumValues;

const SYSTEM_LEAD_ACTIVITY_TYPES = new Set([
  'Assignment',
  'Conversion',
  'Lost Lead',
  'Status Update',
]);

const SYSTEM_CUSTOMER_ACTIVITY_TYPES = new Set([
  'Quotation Approved',
  'Quotation Uploaded',
]);

function isSystemLeadActivity(entry) {
  const type = String(entry?.activityType || '').trim();
  return SYSTEM_LEAD_ACTIVITY_TYPES.has(type);
}

function isSystemCustomerActivity(activity) {
  const type = String(activity?.activityType || '').trim();
  if (SYSTEM_CUSTOMER_ACTIVITY_TYPES.has(type)) {
    return true;
  }

  const notes = String(activity?.notes || activity?.note || '').trim().toLowerCase();
  return notes === 'lead converted to customer';
}

function filterUserCreatedActivities(activities) {
  return (Array.isArray(activities) ? activities : []).filter(
    (activity) => !isSystemCustomerActivity(activity)
  );
}

function mapLeadActivityType(activityType) {
  const value = String(activityType || '').trim();
  if (CUSTOMER_ACTIVITY_TYPES.includes(value)) {
    return value;
  }
  if (value === 'Conversion') {
    return 'Follow-up';
  }
  return 'Call';
}

function toPlainSubdocs(items) {
  return (Array.isArray(items) ? items : []).map((doc) =>
    doc && typeof doc.toObject === 'function' ? doc.toObject() : { ...doc }
  );
}

function noteIdentity(note) {
  const plain = note && typeof note.toObject === 'function' ? note.toObject() : note;
  if (!plain) return '';
  if (plain._id) return `id:${plain._id}`;
  return [
    plain.title || '',
    plain.note || '',
    plain.createdAt ? new Date(plain.createdAt).toISOString() : '',
  ].join('|');
}

function mergeLeadNotesIntoCustomerNotes(customerNotes, leadNotes) {
  const merged = toPlainSubdocs(customerNotes);
  const seen = new Set(merged.map(noteIdentity));

  for (const note of toPlainSubdocs(leadNotes)) {
    const identity = noteIdentity(note);
    if (!identity || seen.has(identity)) continue;
    seen.add(identity);
    merged.push(note);
  }

  return merged.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
}

function mapLeadActivityLogEntry(entry, fallbackUserId) {
  const plain = entry && typeof entry.toObject === 'function' ? entry.toObject() : entry;
  if (!plain?.activityType) return null;

  const noteText = String(plain.note || plain.notes || '').trim();
  const outcomeText = String(plain.outcome || '').trim();
  const activityType = mapLeadActivityType(plain.activityType);

  return {
    activityType,
    date: plain.date ? new Date(plain.date) : plain.createdAt ? new Date(plain.createdAt) : new Date(),
    timeSlot: String(plain.time || plain.timeSlot || '').trim(),
    location: String(plain.location || '').trim(),
    address: String(plain.address || '').trim(),
    notes:
      noteText ||
      (plain.activityType === 'Conversion' ? 'Lead converted to customer' : ''),
    outcome: outcomeText,
    nextFollowUpDate: plain.nextFollowUpDate ? new Date(plain.nextFollowUpDate) : undefined,
    user_id: fallbackUserId || null,
    createdAt: plain.createdAt ? new Date(plain.createdAt) : new Date(),
    source: 'lead',
  };
}

function activityIdentity(activity) {
  return [
    activity.activityType || '',
    activity.date ? new Date(activity.date).toISOString() : '',
    activity.notes || '',
    activity.outcome || '',
    activity.location || '',
  ].join('|');
}

function mergeLeadActivitiesForResponse(customerActivities, leadActivityLog, fallbackUserId) {
  const merged = (Array.isArray(customerActivities) ? customerActivities : []).map((activity) =>
    activity && typeof activity.toObject === 'function' ? activity.toObject() : { ...activity }
  );
  const seen = new Set(merged.map(activityIdentity));

  for (const entry of toPlainSubdocs(leadActivityLog)) {
    if (isSystemLeadActivity(entry)) continue;
    const mapped = mapLeadActivityLogEntry(entry, fallbackUserId);
    if (!mapped) continue;
    const identity = activityIdentity(mapped);
    if (seen.has(identity)) continue;
    seen.add(identity);
    merged.push(mapped);
  }

  return filterUserCreatedActivities(
    merged.sort((a, b) => new Date(b.date || b.createdAt || 0) - new Date(a.date || a.createdAt || 0))
  );
}

async function getLeadHistoryForCustomer(customerOrLeadId) {
  if (!customerOrLeadId) return null;

  if (typeof customerOrLeadId === 'object' && customerOrLeadId.notes !== undefined) {
    return customerOrLeadId;
  }

  const leadId =
    typeof customerOrLeadId === 'object'
      ? customerOrLeadId._id || customerOrLeadId
      : customerOrLeadId;

  if (!leadId) return null;
  return Lead.findById(leadId).select('notes activityLog user_id').lean();
}

async function mergeLeadHistoryForCustomerResponse(customer, customerActivities) {
  const lead = await getLeadHistoryForCustomer(customer.leadId);
  if (!lead) {
    return {
      notes: customer.notes || [],
      activities: filterUserCreatedActivities(customerActivities),
    };
  }

  const fallbackUserId = lead.user_id || customer.user_id || null;

  return {
    notes: mergeLeadNotesIntoCustomerNotes(customer.notes, lead.notes),
    activities: mergeLeadActivitiesForResponse(
      customerActivities,
      lead.activityLog,
      fallbackUserId
    ),
  };
}

async function migrateLeadHistoryToCustomer(lead, customer, actingUserId) {
  const leadPlain = lead?.toObject ? lead.toObject() : lead;
  const customerDoc = customer?.toObject ? customer : customer;
  if (!leadPlain || !customerDoc?._id) return customerDoc;

  const fallbackUserId = leadPlain.user_id || actingUserId || null;
  const mergedNotes = mergeLeadNotesIntoCustomerNotes(customerDoc.notes, leadPlain.notes);

  customerDoc.notes = mergedNotes;
  customerDoc.markModified?.('notes');

  const existingActivities = await CustomerActivity.find({ customer_id: customerDoc._id }).lean();
  const seen = new Set(existingActivities.map(activityIdentity));

  for (const entry of toPlainSubdocs(leadPlain.activityLog)) {
    if (isSystemLeadActivity(entry)) continue;
    const mapped = mapLeadActivityLogEntry(entry, fallbackUserId);
    if (!mapped) continue;

    const identity = activityIdentity(mapped);
    if (seen.has(identity)) continue;
    seen.add(identity);

    await CustomerActivity.create({
      customer_id: customerDoc._id,
      user_id: mapped.user_id || actingUserId,
      activityType: mapped.activityType,
      date: mapped.date,
      timeSlot: mapped.timeSlot,
      location: mapped.location,
      address: mapped.address,
      notes: mapped.notes,
      outcome: mapped.outcome,
      nextFollowUpDate: mapped.nextFollowUpDate,
    });
  }

  if (typeof customerDoc.save === 'function') {
    await customerDoc.save();
  }

  return customerDoc;
}

async function getLeadForCustomer(customer) {
  if (!customer?.leadId) return null;
  if (typeof customer.leadId === 'object' && customer.leadId !== null) {
    return customer.leadId;
  }
  return Lead.findById(customer.leadId).select(LEAD_FIELDS_FOR_POPULATE).lean();
}

async function syncLeadFieldsFromBody(customer, body) {
  if (!customer?.leadId) return;
  const leadId = customer.leadId._id || customer.leadId;
  const lead = await Lead.findById(leadId);
  if (!lead) return;

  let changed = false;
  const setLeadString = (field) => {
    if (body[field] !== undefined) {
      lead[field] = body[field] === null ? '' : String(body[field]).trim();
      changed = true;
    }
  };

  setLeadString('leadName');
  setLeadString('dba');
  if (body.electricCompany !== undefined) {
    lead.electricCompany = body.electricCompany || '';
    changed = true;
  }
  if (body.electric_company !== undefined) {
    lead.electricCompany = body.electric_company || '';
    changed = true;
  }
  if (body.lead_id !== undefined) {
    lead.lead_id = body.lead_id === null ? '' : String(body.lead_id).trim();
    changed = true;
  }

  if (changed) {
    await lead.save();
  }
}

function stripCustomerLogFields(customerObj) {
  if (!customerObj || typeof customerObj !== 'object') return customerObj;
  const copy = { ...customerObj };
  delete copy.lead_id;
  delete copy.leadName;
  delete copy.dba;
  delete copy.electricCompany;
  delete copy.createdByName;
  delete copy.createdByEmail;
  delete copy.createdByRole;
  delete copy.activityLog;
  return copy;
}

module.exports = {
  LEAD_FIELDS_FOR_POPULATE,
  getLeadForCustomer,
  syncLeadFieldsFromBody,
  stripCustomerLogFields,
  mergeLeadNotesIntoCustomerNotes,
  mergeLeadActivitiesForResponse,
  mergeLeadHistoryForCustomerResponse,
  migrateLeadHistoryToCustomer,
  filterUserCreatedActivities,
  isSystemLeadActivity,
  isSystemCustomerActivity,
};
