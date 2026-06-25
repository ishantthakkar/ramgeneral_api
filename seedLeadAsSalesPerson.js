const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('./models/User');
const Role = require('./models/Role');
const { buildPermissionsFromConfig } = require('./constants/roleModules');

const MONGO_URL = process.env.MONGO_URL || 'mongodb://127.0.0.1:27017/ramgeneral';
const API_BASE = process.env.API_BASE || 'http://localhost:5000/api';
const SALES_PERSON_ID = process.argv[2] || '6a1fd7c0c4a071fa498573a1';
const DEFAULT_PASSWORD = process.argv[3] || 'Password123!';

async function ensureSalesPersonRole() {
  const permissions = buildPermissionsFromConfig({
    Dashboard: { view: 1 },
    Leads: { view: 1, create: 1, edit: 1 },
    Customers: { view: 1 },
  });

  return Role.findOneAndUpdate(
    { roleName: 'Sales Person' },
    {
      roleName: 'Sales Person',
      notes: 'Local seed role for sales person lead creation.',
      permissions,
      isSystemRole: false,
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
}

async function prepareSalesPerson(userId, password) {
  const user = await User.findById(userId);
  if (!user) {
    throw new Error(`Sales person not found: ${userId}`);
  }

  const role = await ensureSalesPersonRole();
  const hashedPassword = await bcrypt.hash(password, 10);

  user.password = hashedPassword;
  user.roleId = role._id;
  await user.save();

  return user;
}

async function login(email, password) {
  const response = await fetch(`${API_BASE}/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || 'Login failed.');
  }

  const token = data.accessToken || data.token;
  if (!token) {
    throw new Error('Login succeeded but no access token was returned.');
  }

  return { token, data };
}

async function createLead(token) {
  const suffix = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);

  const payload = {
    leadName: 'Priya Sales Lead',
    dba: 'Priya Test DBA',
    legalName: 'Priya Test Legal LLC',
    accountNumber: `SP-${suffix.slice(-6)}`,
    electricCompany: 'PSE&G',
    billDate: new Date().toISOString(),
    mobileNumber: '(555) 020-3000',
    email: `priya-lead-${suffix}@example.com`,
    leadSource: 'Referral',
    addresses: [
      {
        title: 'Office',
        street: '456 Sales Ave',
        city: 'Jersey City',
        state: 'NJ',
        zip: '07302',
      },
    ],
    contactInfo: [
      {
        position: 'Manager',
        department: 'Operations',
        name: 'Priya Contact',
        phone: '(555) 020-1000',
        mobile: '(555) 020-3000',
        email: `priya-contact-${suffix}@example.com`,
      },
    ],
    notes: [
      {
        title: 'Sales person lead',
        note: 'Created via seedLeadAsSalesPerson.js',
      },
    ],
    activityLog: [
      {
        activityType: 'Call',
        date: new Date().toISOString(),
        note: 'Initial outreach',
      },
    ],
  };

  const response = await fetch(`${API_BASE}/leads-create`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || 'Lead creation failed.');
  }

  return data;
}

async function main() {
  try {
    await mongoose.connect(MONGO_URL, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });

    const user = await prepareSalesPerson(SALES_PERSON_ID, DEFAULT_PASSWORD);
    console.log('Sales person ready:');
    console.log('  id:', user._id.toString());
    console.log('  name:', user.fullName);
    console.log('  email:', user.email);
    console.log('  password:', DEFAULT_PASSWORD);

    const { token } = await login(user.email, DEFAULT_PASSWORD);
    console.log('Login successful.');

    const result = await createLead(token);
    const lead = result.lead || {};

    console.log('Lead created successfully:');
    console.log('  _id:', lead._id);
    console.log('  lead_id:', lead.lead_id);
    console.log('  leadName:', lead.leadName);
    console.log('  user_id:', lead.user_id);
    console.log('');
    console.log('Login in admin with:');
    console.log(`  Email: ${user.email}`);
    console.log(`  Password: ${DEFAULT_PASSWORD}`);

    process.exit(0);
  } catch (error) {
    console.error('seedLeadAsSalesPerson error:', error.message);
    process.exit(1);
  }
}

main();
