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
    price: {
      type: Number,
      required: true,
      min: 0,
    },
    category: {
      type: String,
      required: true,
      enum: CATEGORIES,
      trim: true,
    },
  },
  { timestamps: true }
);

const Product = mongoose.model('Product', productSchema);

module.exports = Product;
module.exports.CATEGORIES = CATEGORIES;
