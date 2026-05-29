const mongoose = require('mongoose');
const Product = require('./models/Product');

const MONGO_URL = process.env.MONGO_URL || 'mongodb://127.0.0.1:27017/ramgeneral';

const SAMPLE_PRODUCTS = [
  { sku: 'RAM-LED-2X4-40W', name: 'LED Panel 2x4 — 40W', price: 89.99, category: 'PSE&G' },
  { sku: 'RAM-T8-18W-4K', name: 'T8 LED Tube 18W 4000K', price: 12.5, category: 'PSE&G' },
  { sku: 'RAM-HB-150W', name: 'High Bay LED 150W', price: 214.0, category: 'PSE&G' },
  { sku: 'RAM-WALL-30W', name: 'Wall Pack 30W Dusk-to-Dawn', price: 67.25, category: 'JCP&L' },
  { sku: 'RAM-CAN-12W', name: 'Retrofit Can Light 12W', price: 24.99, category: 'JCP&L' },
  { sku: 'RAM-FLOOD-50W', name: 'LED Flood Light 50W', price: 45.0, category: 'JCP&L' },
  { sku: 'RAM-STREET-100W', name: 'Street Light LED 100W', price: 189.5, category: 'ATLANTIC CITY ENERGY' },
  { sku: 'RAM-BOLLARD-20W', name: 'Bollard Light 20W', price: 156.75, category: 'ATLANTIC CITY ENERGY' },
  { sku: 'RAM-EXIT-RED', name: 'LED Exit Sign — Red', price: 38.0, category: 'ATLANTIC CITY ENERGY' },
  { sku: 'RAM-EMERG-6W', name: 'Emergency Backup Unit 6W', price: 52.25, category: 'PSE&G' },
  { sku: 'RAM-PENDANT-35W', name: 'Pendant LED 35W', price: 78.99, category: 'JCP&L' },
  { sku: 'RAM-VAPOR-80W', name: 'Vapor Tight Fixture 80W', price: 132.0, category: 'ATLANTIC CITY ENERGY' },
];

const seedProducts = async () => {
  try {
    await mongoose.connect(MONGO_URL);
    let inserted = 0;

    for (const item of SAMPLE_PRODUCTS) {
      const exists = await Product.findOne({ sku: item.sku });
      if (!exists) {
        await Product.create(item);
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
