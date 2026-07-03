/**
 * Seeds workflow demo surveys for testing verify + reopen flows.
 *
 * Usage:
 *   node scripts/seedWorkflowSurveyDummy.js
 *   node scripts/seedWorkflowSurveyDummy.js <customerId>
 */
const mongoose = require('mongoose');
const Customer = require('../models/Customer');
const Survey = require('../models/Survey');

const MONGO_URL = process.env.MONGO_URL || 'mongodb://127.0.0.1:27017/ramgeneral';

const VERIFIED_SURVEY_NAME = 'Workflow Reopen Demo Survey';
const FRESH_SURVEY_NAME = 'Warehouse Lighting Survey';

const VERIFIED_AREAS = [
  {
    areaName: 'Lobby',
    heightFt: '12',
    heightIn: '0',
    existingFixtureType: 'Recessed Can',
    existingBulbs: 'LED PAR38',
    existingQty: '8',
    proposedQty: '8',
    price: '45.00',
    note: 'Uniform spacing along north wall.',
    fixtures: [],
  },
  {
    areaName: 'Conference Room',
    heightFt: '10',
    heightIn: '6',
    existingFixtureType: 'Panel Light',
    existingBulbs: 'T8 LED',
    existingQty: '6',
    proposedQty: '6',
    price: '62.50',
    note: 'Area 2 — verify fixture count before install.',
    fixtures: [],
  },
];

const FRESH_AREAS = [
  {
    areaName: 'Loading Dock',
    heightFt: '18',
    heightIn: '0',
    existingFixtureType: 'High Bay',
    existingBulbs: 'Metal Halide',
    existingQty: '12',
    proposedQty: '12',
    price: '120.00',
    note: 'Replace all high bays with LED equivalents.',
    fixtures: [],
  },
  {
    areaName: 'Storage Aisle',
    heightFt: '14',
    heightIn: '0',
    existingFixtureType: 'Strip Light',
    existingBulbs: 'T8 Fluorescent',
    existingQty: '24',
    proposedQty: '20',
    price: '38.00',
    note: 'Reduce fixture count after layout review.',
    fixtures: [],
  },
  {
    areaName: 'Office Mezzanine',
    heightFt: '9',
    heightIn: '0',
    existingFixtureType: 'Drop Ceiling Panel',
    existingBulbs: 'LED Panel',
    existingQty: '10',
    proposedQty: '10',
    price: '55.00',
    note: 'Standard 2x4 panel swap.',
    fixtures: [],
  },
];

async function upsertSurvey(customerId, surveyName, payload) {
  const existing = await Survey.findOne({ customer_id: customerId, surveyName });

  if (existing) {
    Object.assign(existing, payload);
    const saved = await existing.save();
    console.log(`Updated survey: ${surveyName}`);
    return saved;
  }

  const created = await Survey.create({ customer_id: customerId, surveyName, ...payload });
  console.log(`Created survey: ${surveyName}`);
  return created;
}

function printSurveyInfo(customerId, survey) {
  console.log('');
  console.log(`  Survey: ${survey.surveyName}`);
  console.log('  Survey ID:', survey._id.toString());
  console.log('  Status:  ', survey.status);
  console.log(
    '  View:    /workflow/view/' +
      customerId +
      '?from=Surveys&surveyId=' +
      survey._id.toString()
  );
}

async function seedWorkflowSurveyDummy() {
  const customerIdArg = process.argv[2];

  await mongoose.connect(MONGO_URL, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  });

  const customer = customerIdArg
    ? await Customer.findById(customerIdArg)
    : await Customer.findOne({ leadId: { $ne: null } }).sort({ updatedAt: -1 });

  if (!customer) {
    console.error('No customer found. Pass a customer id: node scripts/seedWorkflowSurveyDummy.js <customerId>');
    process.exit(1);
  }

  const now = new Date();

  const verifiedSurvey = await upsertSurvey(customer._id, VERIFIED_SURVEY_NAME, {
    status: 'completed',
    confirmDate: now,
    surveyDate: now,
    areas: VERIFIED_AREAS,
    reopenNote: [],
  });

  const freshSurvey = await upsertSurvey(customer._id, FRESH_SURVEY_NAME, {
    status: 'submitted',
    confirmDate: undefined,
    surveyDate: now,
    areas: FRESH_AREAS,
    reopenNote: [],
  });

  customer.status = 'submitted';
  customer.verifyStatus = customer.verifyStatus || 'pending';
  await customer.save();

  console.log('');
  console.log('Workflow demo surveys ready for customer:', customer._id.toString());
  printSurveyInfo(customer._id.toString(), verifiedSurvey);
  printSurveyInfo(customer._id.toString(), freshSurvey);

  console.log('');
  console.log('Sample reopen curl (fresh survey):');
  console.log(`curl --location 'http://localhost:5000/api/surveys/reopen' \\`);
  console.log(`--header 'Authorization: Bearer <token>' \\`);
  console.log(`--header 'Content-Type: application/json' \\`);
  console.log(`--data '{`);
  console.log(`    "survey_id": "${freshSurvey._id.toString()}",`);
  console.log(`    "title": "Missing fixtures",`);
  console.log(`    "note": "Please re-verify loading dock fixture count"`);
  console.log(`}'`);

  await mongoose.disconnect();
  process.exit(0);
}

seedWorkflowSurveyDummy().catch((error) => {
  console.error('Seed error:', error);
  process.exit(1);
});
