const mongoose = require('mongoose');
const Customer = require('../models/Customer');
const Lead = require('../models/Lead');
const Product = require('../models/Product');
const { CATEGORIES } = require('../models/Product');

const resolveProductCategory = (electricCompany) => {
  if (!electricCompany) return null;
  const normalized = electricCompany.toString().trim();
  return (
    CATEGORIES.find((c) => c.toLowerCase() === normalized.toLowerCase()) || null
  );
};

const getElectricCompanyForCustomer = async (customerId) => {
  const customer = await Customer.findById(customerId).select('leadId');
  if (!customer?.leadId) return '';

  const lead = await Lead.findById(customer.leadId).select('electricCompany');
  return lead?.electricCompany?.trim() || '';
};

const toProductObjectId = (value) => {
  if (!value) return null;
  const id = value.toString().trim();
  if (!mongoose.Types.ObjectId.isValid(id)) return null;
  return new mongoose.Types.ObjectId(id);
};

const validateAreaProducts = async (areas, category) => {
  for (const area of areas) {
    if (!area.product_id) continue;

    const product = await Product.findById(area.product_id);
    if (!product) {
      return {
        valid: false,
        message: 'Product not found for one of the survey area items.',
      };
    }
  }
  return { valid: true };
};

const enrichAreasWithProducts = async (areas) => {
  if (!Array.isArray(areas) || areas.length === 0) return [];

  const productIds = areas
    .map((a) => a.product_id)
    .filter((id) => id && mongoose.Types.ObjectId.isValid(id.toString()));

  const products = productIds.length
    ? await Product.find({ _id: { $in: productIds } }).lean()
    : [];

  const productMap = new Map(products.map((p) => [p._id.toString(), p]));

  return areas.map((area) => {
    const plain = area?.toObject ? area.toObject() : { ...area };
    const productId = plain.product_id?.toString?.() || plain.product_id || null;

    return {
      ...plain,
      product: productId ? productMap.get(productId) || null : null,
    };
  });
};

module.exports = {
  CATEGORIES,
  resolveProductCategory,
  getElectricCompanyForCustomer,
  toProductObjectId,
  validateAreaProducts,
  enrichAreasWithProducts,
};
