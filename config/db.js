const mongoose = require('mongoose');
const Product = require('../models/Product');

const MONGO_URL = process.env.MONGO_URL || 'mongodb://127.0.0.1:27017/ramgeneral';

async function syncCustomerAccountNumberIndexes() {
  const Customer = require('../models/Customer');

  try {
    const indexes = await Customer.collection.indexes();
    const uniqueAccountNumberIndex = indexes.find(
      (idx) => idx.key?.accountNumber === 1 && idx.unique
    );

    if (uniqueAccountNumberIndex?.name) {
      await Customer.collection.dropIndex(uniqueAccountNumberIndex.name);
      console.log(`Dropped unique customer accountNumber index: ${uniqueAccountNumberIndex.name}`);
    }
  } catch (error) {
    if (error.code !== 27) {
      console.warn('Customer accountNumber index sync:', error.message);
    }
  }
}

async function syncProductSkuIndexes() {
  try {
    const indexes = await Product.collection.indexes();
    const uniqueSkuIndex = indexes.find((idx) => idx.key?.sku === 1 && idx.unique);

    if (uniqueSkuIndex?.name) {
      await Product.collection.dropIndex(uniqueSkuIndex.name);
      console.log(`Dropped unique product SKU index: ${uniqueSkuIndex.name}`);
    }
  } catch (error) {
    if (error.code !== 27) {
      console.warn('Product SKU index sync:', error.message);
    }
  }
}

const connectDB = async () => {
  try {
    await mongoose.connect(MONGO_URL, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('MongoDB connected');
    await syncCustomerAccountNumberIndexes();
    await syncProductSkuIndexes();
    const { seedSystemRoles } = require('../utils/seedRoles');
    await seedSystemRoles();
    console.log('System roles synced');
  } catch (error) {
    console.error('MongoDB connection error:', error.message);
    process.exit(1);
  }
};

module.exports = connectDB;
