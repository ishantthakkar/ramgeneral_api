const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const Product = require('./models/Product');

const MONGO_URL = process.env.MONGO_URL || 'mongodb://127.0.0.1:27017/ramgeneral';
const SURVEY_ID = process.argv[2] || '6a3bc0ff21eeea911a66789f';
const LOGIN_EMAIL = process.argv[3] || 'priya@yopmail.com';
const LOGIN_PASSWORD = process.argv[4] || 'Password123!';

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

async function apiPost(token, endpoint, body) {
  const response = await fetch(`${API_BASE}${endpoint}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`API ${endpoint} returned non-JSON (${response.status}): ${text.slice(0, 200)}`);
  }

  if (!response.ok) {
    throw new Error(data.message || `API ${endpoint} failed.`);
  }

  return data;
}

async function resolveProducts() {
  const preferred = await Product.find({ category: 'PSE&G' }).sort({ createdAt: 1 }).limit(2).lean();
  if (preferred.length >= 2) {
    return preferred;
  }

  const fallback = await Product.find().sort({ createdAt: 1 }).limit(2).lean();
  if (fallback.length < 1) {
    throw new Error('No products found. Run seedProducts.js first.');
  }

  return fallback;
}

function buildAreasPayload(products) {
  const [productA, productB] = products;

  return [
    {
      areaName: 'Main Office',
      note: 'Front office lighting retrofit',
      fixtures: [
        {
          product_id: String(productA._id),
          proposedQty: '4',
          price: String(productA.salesPrice || productA.price || 0),
          existingFixtureType: 'Fluorescent 2x4',
          existingBulbs: '4',
          heightFt: '9',
          heightIn: '0',
          note: 'Replace existing troffers',
        },
      ],
    },
    {
      areaName: 'Warehouse',
      note: 'High bay replacement area',
      fixtures: [
        {
          product_id: String((productB || productA)._id),
          proposedQty: '6',
          price: String((productB || productA).salesPrice || (productB || productA).price || 0),
          existingFixtureType: 'Metal Halide High Bay',
          existingBulbs: '1',
          heightFt: '20',
          heightIn: '0',
          note: 'Upgrade to LED high bays',
        },
      ],
    },
  ];
}

async function main() {
  try {
    await mongoose.connect(MONGO_URL, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });

    const products = await resolveProducts();
    const areas = buildAreasPayload(products);

    console.log('API base:', API_BASE);
    console.log('Survey ID:', SURVEY_ID);
    console.log('Products:', products.map((p) => p.name).join(', '));

    const token = await login(LOGIN_EMAIL, LOGIN_PASSWORD);
    console.log('Login successful:', LOGIN_EMAIL);

    const areaResult = await apiPost(token, '/add-area', {
      survey_id: SURVEY_ID,
      areas,
    });
    console.log('Survey areas saved:', areaResult.message || 'OK');

    const preview = await apiPost(token, '/customer/quotation/preview', {
      surveyId: SURVEY_ID,
    });
    console.log(
      'Quotation preview total:',
      preview.estimate?.grandTotal ?? preview.estimate?.area?.length ?? 'ready'
    );

    const quotation = await apiPost(token, '/customer/quotation', {
      surveyId: SURVEY_ID,
    });

    console.log('Quotation generated successfully:');
    console.log('  quotationNumber:', quotation.quotationNumber);
    console.log('  pdfUrl:', quotation.pdfUrl);
    console.log('');
    console.log('View in admin:');
    console.log(
      `  http://localhost:3000/workflow/quotations/6a3ba69a1dcf90909dcd113e?surveyId=${SURVEY_ID}&from=Quotations`
    );

    process.exit(0);
  } catch (error) {
    console.error('seedGenerateQuotation error:', error.message);
    process.exit(1);
  }
}

main();
