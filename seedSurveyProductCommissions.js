const mongoose = require('mongoose');
const Survey = require('./models/Survey');
const Product = require('./models/Product');

const MONGO_URL = process.env.MONGO_URL || 'mongodb://127.0.0.1:27017/ramgeneral';
const SURVEY_ID = process.argv[2] || '6a3bc0ff21eeea911a66789f';

const COMMISSION_BY_SKU = {
  'RAM-LED-2X4-40W': { agentCommission: 12.5, managerCommission: 5, installationCost: 25 },
  'RAM-T8-18W-4K': { agentCommission: 2, managerCommission: 1, installationCost: 5 },
  'RAM-HB-150W': { agentCommission: 30, managerCommission: 12, installationCost: 45 },
  'RAM-WALL-30W': { agentCommission: 8, managerCommission: 3, installationCost: 18 },
  'RAM-CAN-12W': { agentCommission: 3.5, managerCommission: 1.5, installationCost: 8 },
  'RAM-FLOOD-50W': { agentCommission: 6, managerCommission: 2.5, installationCost: 12 },
  'RAM-STREET-100W': { agentCommission: 22, managerCommission: 9, installationCost: 40 },
  'RAM-BOLLARD-20W': { agentCommission: 18, managerCommission: 7, installationCost: 32 },
  'RAM-EXIT-RED': { agentCommission: 5, managerCommission: 2, installationCost: 10 },
  'RAM-EMERG-6W': { agentCommission: 7, managerCommission: 3, installationCost: 14 },
  'RAM-PENDANT-35W': { agentCommission: 10, managerCommission: 4, installationCost: 20 },
  'RAM-VAPOR-80W': { agentCommission: 15, managerCommission: 6, installationCost: 28 },
};

async function main() {
  await mongoose.connect(MONGO_URL);

  const survey = await Survey.findById(SURVEY_ID);
  if (!survey) {
    throw new Error(`Survey not found: ${SURVEY_ID}`);
  }

  const productIds = [
    ...new Set(
      (survey.areas || [])
        .flatMap((area) => (area.fixtures || []).map((fixture) => fixture.product_id?.toString()))
        .filter(Boolean)
    ),
  ];

  if (!productIds.length) {
    throw new Error('No products found on survey fixtures.');
  }

  const products = await Product.find({ _id: { $in: productIds } });
  const priceByProductId = new Map();

  for (const area of survey.areas || []) {
    for (const fixture of area.fixtures || []) {
      const productId = fixture.product_id?.toString();
      const fixturePrice = parseFloat(fixture.price);
      if (productId && Number.isFinite(fixturePrice) && fixturePrice > 0) {
        priceByProductId.set(productId, fixturePrice);
      }
    }
  }

  let updated = 0;

  for (const product of products) {
    const rates = COMMISSION_BY_SKU[product.sku];
    if (!rates) {
      console.warn(`Skipping ${product.sku} — no commission mapping defined.`);
      continue;
    }

    const salesPrice =
      priceByProductId.get(product._id.toString()) ||
      product.salesPrice ||
      product.utilityPrice ||
      0;

    await Product.updateOne(
      { _id: product._id },
      {
        $set: {
          agentCommission: rates.agentCommission,
          managerCommission: rates.managerCommission,
          installationCost: rates.installationCost,
          commission: rates.agentCommission,
          ...(salesPrice > 0 ? { salesPrice, utilityPrice: salesPrice } : {}),
        },
      }
    );
    updated += 1;

    console.log(
      `Updated ${product.sku}: agent=${rates.agentCommission}, manager=${rates.managerCommission}, install=${rates.installationCost}`
    );
  }

  const Customer = require('./models/Customer');
  const { syncPayablesForCustomer } = require('./utils/payablesUtils');
  const customer = await Customer.findById(survey.customer_id);
  if (customer) {
    await syncPayablesForCustomer(customer);
    await customer.save();
    console.log('Synced payables for customer:', customer._id.toString());
  }

  const { calculateSurveyPayables } = require('./utils/payablesUtils');
  const payables = await calculateSurveyPayables(survey, customer);
  console.log('\nCalculated payables for survey:');
  console.log('  Sales Person commission:', payables.salesCommission);
  console.log('  Sales Manager commission:', payables.managerCommission);
  console.log('  Contractor commission:', payables.contractorCommission);
  console.log('  Quotation amount:', payables.quotationAmount);

  console.log(`\nDone. Updated ${updated} product(s).`);
  process.exit(0);
}

main().catch((error) => {
  console.error('seedSurveyProductCommissions error:', error.message);
  process.exit(1);
});
