const fs = require('fs');
const path = require('path');

const SURVEY_ID = process.argv[2] || '6a3bc0ff21eeea911a66789f';
const ADMIN_EMAIL = process.argv[3] || 'admin@ramgeneral.com';
const ADMIN_PASSWORD = process.argv[4] || 'Password123!';

const DEFAULT_EXPENSES = [
  { description: 'Parking', price: 25 },
  { description: 'Tools', price: 75.5 },
];

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
    throw new Error(data.message || 'Admin login failed.');
  }

  if (!data.accessToken) {
    throw new Error('Login succeeded but no access token was returned.');
  }

  return data.accessToken;
}

async function seedExtraExpenses(token) {
  const extraExpenses = DEFAULT_EXPENSES;
  const totalAmount = extraExpenses.reduce((sum, item) => sum + item.price, 0);

  const form = new FormData();
  form.append('survey_id', SURVEY_ID);
  form.append('extraExpenses', JSON.stringify(extraExpenses));
  form.append('totalAmount', String(totalAmount));

  const response = await fetch(`${API_BASE}/surveys/extra-expenses`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: form,
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || 'Failed to save extra expenses.');
  }

  return data;
}

async function main() {
  console.log(`API: ${API_BASE}`);
  console.log(`Survey: ${SURVEY_ID}`);

  const token = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
  console.log(`Logged in as ${ADMIN_EMAIL}`);

  const result = await seedExtraExpenses(token);
  console.log('Extra expenses saved:');
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
