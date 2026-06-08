const mongoose = require('mongoose');
const Product = require('../models/Product');

const MONGO_URL = process.env.MONGO_URL || 'mongodb://127.0.0.1:27017/ramgeneral';

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
    await syncProductSkuIndexes();
  } catch (error) {
    console.error('MongoDB connection error:', error.message);
    process.exit(1);
  }
};

module.exports = connectDB;
