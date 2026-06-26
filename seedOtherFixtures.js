const mongoose = require('mongoose');
const Product = require('./models/Product');

const MONGO_URL = process.env.MONGO_URL || 'mongodb://127.0.0.1:27017/ramgeneral';

const DEMO_OTHER_FIXTURES = [
  { sku: 'EF-DEMO-001', name: 'Vintage Brass Chandelier' },
  { sku: 'EF-DEMO-002', name: 'Custom Track Light — 4 Head' },
  { sku: 'EF-DEMO-003', name: 'Warehouse Metal Halide (Legacy)' },
  { sku: 'EF-DEMO-004', name: 'Decorative Pendant — Glass Shade' },
  { sku: 'EF-DEMO-005', name: 'Outdoor String Light Cluster' },
  { sku: 'EF-DEMO-006', name: 'Fluorescent U-Bend 2x2 (Old Stock)' },
];

const seedOtherFixtures = async () => {
  try {
    await mongoose.connect(MONGO_URL);
    let inserted = 0;
    let skipped = 0;

    for (const item of DEMO_OTHER_FIXTURES) {
      const exists = await Product.findOne({
        productType: 'Existing Fixture',
        name: { $regex: new RegExp(`^${item.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
      });

      if (exists) {
        skipped += 1;
        continue;
      }

      await Product.create({
        sku: item.sku,
        name: item.name,
        salesPrice: 0,
        commission: 0,
        installationCost: 0,
        productType: 'Existing Fixture',
        isOtherFixture: true,
      });
      inserted += 1;
    }

    console.log(
      `Other fixtures seed complete. Inserted ${inserted} new, skipped ${skipped} existing.`
    );
    process.exit(0);
  } catch (error) {
    console.error('Seed other fixtures error:', error);
    process.exit(1);
  }
};

seedOtherFixtures();
