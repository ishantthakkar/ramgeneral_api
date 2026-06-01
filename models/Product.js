const mongoose = require('mongoose');

const CATEGORIES = ['PSE&G', 'JCP&L', 'ATLANTIC CITY ENERGY'];

const productSchema = new mongoose.Schema(
  {
    sku: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    salesPrice: {
      type: Number,
      required: true,
      min: 0,
    },
    commission: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },
    installationCost: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },
    category: {
      type: String,
      enum: CATEGORIES,
      trim: true,
    },
    price: {
      type: Number,
      min: 0,
    },
  },
  { timestamps: true }
);

const Product = mongoose.model('Product', productSchema);

module.exports = Product;
module.exports.CATEGORIES = CATEGORIES;
