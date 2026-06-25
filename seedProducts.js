const mongoose = require('mongoose');
const Product = require('./models/Product');

const MONGO_URL = process.env.MONGO_URL || 'mongodb://127.0.0.1:27017/ramgeneral';

const SAMPLE_PRODUCTS = [
  { sku: 'RAM-LED-2X4-40W', name: 'LED Panel 2x4 — 40W', salesPrice: 89.99, commission: 12.5, installationCost: 25.0, category: 'PSE&G' },
  { sku: 'RAM-T8-18W-4K', name: 'T8 LED Tube 18W 4000K', salesPrice: 12.5, commission: 2.0, installationCost: 5.0, category: 'PSE&G' },
  { sku: 'RAM-HB-150W', name: 'High Bay LED 150W', salesPrice: 214.0, commission: 30.0, installationCost: 45.0, category: 'PSE&G' },
  { sku: 'RAM-WALL-30W', name: 'Wall Pack 30W Dusk-to-Dawn', salesPrice: 67.25, commission: 8.0, installationCost: 18.0, category: 'JCP&L' },
  { sku: 'RAM-CAN-12W', name: 'Retrofit Can Light 12W', salesPrice: 24.99, commission: 3.5, installationCost: 8.0, category: 'JCP&L' },
  { sku: 'RAM-FLOOD-50W', name: 'LED Flood Light 50W', salesPrice: 45.0, commission: 6.0, installationCost: 12.0, category: 'JCP&L' },
  { sku: 'RAM-STREET-100W', name: 'Street Light LED 100W', salesPrice: 189.5, commission: 22.0, installationCost: 40.0, category: 'ATLANTIC CITY ENERGY' },
  { sku: 'RAM-BOLLARD-20W', name: 'Bollard Light 20W', salesPrice: 156.75, commission: 18.0, installationCost: 32.0, category: 'ATLANTIC CITY ENERGY' },
  { sku: 'RAM-EXIT-RED', name: 'LED Exit Sign — Red', salesPrice: 38.0, commission: 5.0, installationCost: 10.0, category: 'ATLANTIC CITY ENERGY' },
  { sku: 'RAM-EMERG-6W', name: 'Emergency Backup Unit 6W', salesPrice: 52.25, commission: 7.0, installationCost: 14.0, category: 'PSE&G' },
  { sku: 'RAM-PENDANT-35W', name: 'Pendant LED 35W', salesPrice: 78.99, commission: 10.0, installationCost: 20.0, category: 'JCP&L' },
  { sku: 'RAM-VAPOR-80W', name: 'Vapor Tight Fixture 80W', salesPrice: 132.0, commission: 15.0, installationCost: 28.0, category: 'ATLANTIC CITY ENERGY' },
];

const seedProducts = async () => {
  try {
    await mongoose.connect(MONGO_URL);
    let inserted = 0;

    for (const item of SAMPLE_PRODUCTS) {
      const exists = await Product.findOne({ sku: item.sku });
      if (!exists) {
        await Product.create({
          ...item,
          agentCommission: item.commission,
          managerCommission: Math.round(item.commission * 0.4 * 100) / 100,
        });
        inserted += 1;
      }
    }

    console.log(`Products seed complete. Inserted ${inserted} new product(s).`);
    process.exit(0);
  } catch (error) {
    console.error('Seed products error:', error);
    process.exit(1);
  }
};

seedProducts();
