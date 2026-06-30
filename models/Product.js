const mongoose = require('mongoose');

const CATEGORIES = ['PSE&G', 'JCP&L', 'ATLANTIC CITY ENERGY'];
const FIXTURE_TYPES = ['Proposed Fixture', 'Existing Fixture', 'Accessories'];
const ACCESSORY_TYPES = ['Independent', 'Combo'];

const productSchema = new mongoose.Schema(
  {
    sku: {
      type: String,
      required: true,
      trim: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    utilityPrice: {
      type: Number,
      min: 0,
      default: 0,
    },
    directPrice: {
      type: Number,
      min: 0,
      default: 0,
    }, 
    agentCommission: {
      type: Number,
      min: 0,
      default: 0,
    },
    managerCommission: {
      type: Number,
      min: 0,
      default: 0,
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
    productType: {
      type: String,
      enum: FIXTURE_TYPES,
      trim: true,
      default: 'Proposed Fixture',
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
    isOtherFixture: {
      type: Boolean,
      default: false,
    },
    accessoryType: {
      type: String,
      enum: ACCESSORY_TYPES,
      trim: true,
    },
    description: {
      type: String,
      trim: true,
      default: '',
    },
    isComboItem: {
      type: Boolean,
      default: false,
    },
    comboAccessoryIds: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Product',
      },
    ],
  },
  { timestamps: true }
);

productSchema.index({ sku: 1, productType: 1 }, { unique: true });

const Product = mongoose.model('Product', productSchema);

module.exports = Product;
module.exports.CATEGORIES = CATEGORIES;
module.exports.FIXTURE_TYPES = FIXTURE_TYPES;
module.exports.ACCESSORY_TYPES = ACCESSORY_TYPES;
