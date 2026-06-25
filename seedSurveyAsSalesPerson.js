const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const User = require('./models/User');
const Customer = require('./models/Customer');

const MONGO_URL = process.env.MONGO_URL || 'mongodb://127.0.0.1:27017/ramgeneral';
const SALES_PERSON_EMAIL = process.argv[2] || 'priya@yopmail.com';
const SALES_PERSON_PASSWORD = process.argv[3] || 'Password123!';
const CUSTOMER_ID = process.argv[4] || '6a3ba69a1dcf90909dcd113e';
const SURVEY_NAME = process.argv[5] || 'Priya Sales Site Survey';

function resolveApiBase() {
  if (process.env.API_BASE) {
    return process.env.API_BASE.replace(/\/$/, '');
  }

  const envPath = path.join(__dirname, '..', 'ramgernal_admin', '.env');
  if (fs.existsSync(envPath)) {
    const envText = fs.readFileSync(envPath, 'utf8');
    const match = envText.match(/^API_PROXY_TARGET=(.+)$/m);
    if (match?.[1]) {
      return match[1].trim().replace(/\/$/, '');
    }
  }

  return 'http://localhost:5000/api';
}

const API_BASE = resolveApiBase();

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

  const token = data.accessToken;
  if (!token) {
    throw new Error('Login succeeded but no access token was returned.');
  }

  return { token, data };
}

async function createSurvey(token, customerId, surveyName) {
  const response = await fetch(`${API_BASE}/create-surveys`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      customer_id: customerId,
      surveyName,
    }),
  });

  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Survey API returned non-JSON (${response.status}): ${text.slice(0, 200)}`);
  }

  if (!response.ok) {
    throw new Error(data.message || 'Survey creation failed.');
  }

  return data;
}

async function main() {
  try {
    await mongoose.connect(MONGO_URL, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });

    const user = await User.findOne({ email: SALES_PERSON_EMAIL.toLowerCase() });
    if (!user) {
      throw new Error(`Sales person not found: ${SALES_PERSON_EMAIL}`);
    }

    const customer = await Customer.findById(CUSTOMER_ID).populate('user_id', 'fullName email');
    if (!customer) {
      throw new Error(`Customer not found: ${CUSTOMER_ID}`);
    }

    console.log('API base:', API_BASE);
    console.log('Sales person:', user.fullName, `(${user.email})`);
    console.log('Customer:', customer.name || customer.leadName, `(${customer._id})`);

    const { token } = await login(SALES_PERSON_EMAIL, SALES_PERSON_PASSWORD);
    console.log('Login successful.');

    const result = await createSurvey(token, CUSTOMER_ID, SURVEY_NAME);
    const survey = result.survey || {};

    console.log('Survey created successfully:');
    console.log('  _id:', survey._id);
    console.log('  surveyName:', survey.surveyName);
    console.log('  status:', survey.status);
    console.log('  customer_id:', survey.customer_id);
    console.log('');
    console.log('View in admin:');
    console.log(`  http://localhost:3000/customers/${CUSTOMER_ID}`);
    console.log(`  http://localhost:3000/workflow/edit/${CUSTOMER_ID}?surveyId=${survey._id}&from=Surveys`);

    process.exit(0);
  } catch (error) {
    console.error('seedSurveyAsSalesPerson error:', error.message);
    process.exit(1);
  }
}

main();
