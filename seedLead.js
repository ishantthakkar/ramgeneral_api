const mongoose = require('mongoose');
const Lead = require('./models/Lead');

const MONGO_URL = process.env.MONGO_URL || 'mongodb://127.0.0.1:27017/ramgeneral';

function buildDefaultLead() {
  const suffix = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  const leadId = `LOCAL-${suffix}`;

  return {
    lead_id: leadId,
    leadName: 'Local Test Lead',
    dba: 'Local Test DBA',
    legalName: 'Local Test Legal Name LLC',
    accountNumber: `ACCT-${suffix.slice(-6)}`,
    electricCompany: 'PSE&G',
    billDate: new Date(),
    mobileNumber: '(555) 010-2000',
    email: `local-lead-${suffix}@example.com`,
    leadSource: 'REFERRAL',
    addresses: [
      {
        title: 'Office',
        street: '123 Local St',
        city: 'Newark',
        state: 'NJ',
        zip: '07102',
      },
    ],
    contactInfo: [
      {
        position: 'Owner',
        department: 'Management',
        name: 'Local Contact',
        phone: '(555) 010-1000',
        mobile: '(555) 010-2000',
        email: `local-contact-${suffix}@example.com`,
        businessCard: [],
      },
    ],
    notes: [
      {
        title: 'Seeded lead',
        note: 'Created by seedLead.js for local testing.',
      },
    ],
    activityLog: [
      {
        activityType: 'Call',
        location: '',
        date: new Date(),
        time: '',
        note: 'Initial outreach (seed)',
      },
    ],
    status: 'New',
    convertedToCustomer: false,
    lostReason: '',
    createdByName: 'Local Seeder',
    createdByEmail: 'local-seeder@ramgeneral.com',
    createdByRole: 'admin',
  };
}

async function seedLead() {
  try {
    await mongoose.connect(MONGO_URL, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });

    const lead = buildDefaultLead();
    const existing = await Lead.findOne({ lead_id: lead.lead_id }).lean();
    if (existing) {
      console.log('Lead already exists:', existing.lead_id);
      process.exit(0);
    }

    const created = await Lead.create(lead);
    console.log('Lead seeded successfully:');
    console.log('  _id:', created._id.toString());
    console.log('  lead_id:', created.lead_id);
    console.log('  leadName:', created.leadName);
    console.log('  email:', created.email);
    process.exit(0);
  } catch (error) {
    console.error('Seed lead error:', error);
    process.exit(1);
  }
}

seedLead();
