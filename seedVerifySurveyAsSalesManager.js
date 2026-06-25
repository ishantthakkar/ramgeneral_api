const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const User = require('./models/User');
const Survey = require('./models/Survey');
const Customer = require('./models/Customer');

const MONGO_URL = process.env.MONGO_URL || 'mongodb://127.0.0.1:27017/ramgeneral';
const SURVEY_ID = process.argv[2] || '6a3bc0ff21eeea911a66789f';
const DEFAULT_PASSWORD = process.argv[3] || 'Password123!';

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

  return token;
}

async function verifySurvey(token, surveyId) {
  const response = await fetch(`${API_BASE}/customer/${surveyId}/completed/update-status`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({}),
  });

  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Verify API returned non-JSON (${response.status}): ${text.slice(0, 200)}`);
  }

  if (!response.ok) {
    throw new Error(data.message || 'Survey verify failed.');
  }

  return data;
}

async function resolveSalesManagerForSurvey(surveyId) {
  const survey = await Survey.findById(surveyId);
  if (!survey) {
    throw new Error(`Survey not found: ${surveyId}`);
  }

  const customer = await Customer.findById(survey.customer_id).populate({
    path: 'user_id',
    populate: { path: 'reportsTo', select: 'fullName email userRole' },
  });

  if (!customer) {
    throw new Error(`Customer not found for survey: ${surveyId}`);
  }

  const salesPerson = customer.user_id;
  const salesManager =
    salesPerson?.reportsTo && typeof salesPerson.reportsTo === 'object'
      ? salesPerson.reportsTo
      : null;

  if (!salesManager?._id) {
    throw new Error('Sales manager not found for this customer sales person.');
  }

  return {
    survey,
    customer,
    salesManager: await User.findById(salesManager._id),
  };
}

async function ensurePassword(user, password) {
  user.password = await bcrypt.hash(password, 10);
  await user.save();
}

async function main() {
  try {
    await mongoose.connect(MONGO_URL, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });

    const { survey, customer, salesManager } = await resolveSalesManagerForSurvey(SURVEY_ID);
    if (!salesManager?.email) {
      throw new Error('Sales manager email is missing.');
    }

    await ensurePassword(salesManager, DEFAULT_PASSWORD);

    console.log('API base:', API_BASE);
    console.log('Survey:', survey.surveyName, `(${survey._id})`);
    console.log('Customer:', customer.name || customer.leadName, `(${customer._id})`);
    console.log('Sales manager:', salesManager.fullName, `(${salesManager.email})`);

    const token = await login(salesManager.email, DEFAULT_PASSWORD);
    console.log('Sales manager login successful.');

    const result = await verifySurvey(token, SURVEY_ID);
    const updatedSurvey = result.survey || {};

    console.log('Survey verified successfully:');
    console.log('  _id:', updatedSurvey._id);
    console.log('  status:', updatedSurvey.status);
    console.log('  confirmDate:', updatedSurvey.confirmDate);
    console.log('');
    console.log('View in admin:');
    console.log(
      `  http://localhost:3000/workflow/view/${customer._id}?from=Surveys&surveyId=${SURVEY_ID}`
    );

    process.exit(0);
  } catch (error) {
    console.error('seedVerifySurveyAsSalesManager error:', error.message);
    process.exit(1);
  }
}

main();
