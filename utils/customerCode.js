function buildRandomCustomerCode() {
  const suffix = Math.floor(100000 + Math.random() * 900000);
  return `CUS-${suffix}`;
}

async function generateUniqueCustomerCode(maxAttempts = 20) {
  const Customer = require('../models/Customer');

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const code = buildRandomCustomerCode();
    const exists = await Customer.exists({ customerCode: code });
    if (!exists) {
      return code;
    }
  }

  return `CUS-${Date.now().toString(36).toUpperCase()}`;
}

async function backfillMissingCustomerCodes() {
  const Customer = require('../models/Customer');
  const customers = await Customer.find({
    $or: [{ customerCode: { $exists: false } }, { customerCode: null }, { customerCode: '' }],
  }).select('_id customerCode');

  for (const customer of customers) {
    customer.customerCode = await generateUniqueCustomerCode();
    await customer.save();
  }

  if (customers.length) {
    console.log(`Backfilled customerCode for ${customers.length} customer(s).`);
  }
}

module.exports = {
  buildRandomCustomerCode,
  generateUniqueCustomerCode,
  backfillMissingCustomerCodes,
};
