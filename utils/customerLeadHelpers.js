const Lead = require('../models/Lead');

const LEAD_FIELDS_FOR_POPULATE =
  'lead_id leadName name dba legalName electricCompany createdByName createdByEmail createdByRole';

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
};
