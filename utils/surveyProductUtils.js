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

const flattenAreaFixtures = (areas) => {
  if (!Array.isArray(areas)) return [];

  return areas.flatMap((area) => {
    const plain = area?.toObject ? area.toObject() : area;
    if (Array.isArray(plain?.fixtures) && plain.fixtures.length > 0) {
      return plain.fixtures;
    }
    if (plain?.product_id) {
      return [plain];
    }
    return [];
  });
};

const validateAreaProducts = async (areas, category) => {
  const fixtures = flattenAreaFixtures(areas);

  for (const fixture of fixtures) {
    if (!fixture.product_id) continue;

    const product = await Product.findById(fixture.product_id);
    if (!product) {
      return {
        valid: false,
        message: 'Product not found for one of the survey area items.',
      };
    }
  }
  return { valid: true };
};

const enrichFixturesWithProducts = async (fixtures) => {
  if (!Array.isArray(fixtures) || fixtures.length === 0) return [];

  const productIds = fixtures
    .map((f) => f.product_id)
    .filter((id) => id && mongoose.Types.ObjectId.isValid(id.toString()));

  const products = productIds.length
    ? await Product.find({ _id: { $in: productIds } }).lean()
    : [];

  const productMap = new Map(products.map((p) => [p._id.toString(), p]));

  return fixtures.map((fixture) => {
    const plain = fixture?.toObject ? fixture.toObject() : { ...fixture };
    const productId = plain.product_id?.toString?.() || plain.product_id || null;

    return {
      ...plain,
      product: productId ? productMap.get(productId) || null : null,
    };
  });
};

const enrichAreasWithProducts = async (areas) => {
  if (!Array.isArray(areas) || areas.length === 0) return [];

  return Promise.all(
    areas.map(async (area) => {
      const plain = area?.toObject ? area.toObject() : { ...area };

      if (Array.isArray(plain.fixtures)) {
        return {
          ...plain,
          fixtures: await enrichFixturesWithProducts(plain.fixtures),
        };
      }

      if (plain.product_id) {
        const [enrichedFixture] = await enrichFixturesWithProducts([plain]);
        return {
          areaName: plain.areaName || '',
          note: plain.note || '',
          images: plain.images || [],
          fixtures: [enrichedFixture],
        };
      }

      return {
        ...plain,
        fixtures: plain.fixtures || [],
      };
    })
  );
};

module.exports = {
  CATEGORIES,
  resolveProductCategory,
  getElectricCompanyForCustomer,
  toProductObjectId,
  validateAreaProducts,
  enrichAreasWithProducts,
  enrichFixturesWithProducts,
  flattenAreaFixtures,
};
