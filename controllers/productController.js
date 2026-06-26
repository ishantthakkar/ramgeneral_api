const mongoose = require('mongoose');
const Product = require('../models/Product');
const Survey = require('../models/Survey');
const { createLog } = require('../utils/logger');
const { CATEGORIES } = require('../models/Product');
const {
  FIXTURE_TYPES,
  resolveFixtureType,
  buildFixtureTypeFilter,
} = require('../utils/productUtils');

function resolveUtilityPrice(product) {
  const utilityPrice = product.utilityPrice ?? product.salesPrice ?? product.price ?? 0;
  return Number(utilityPrice) || 0;
}

function resolveDirectPrice(product) {
  return Number(product.directPrice ?? 0) || 0;
}

function resolveAgentCommission(product) {
  return Number(product.agentCommission ?? product.commission ?? 0) || 0;
}

function resolveManagerCommission(product) {
  return Number(product.managerCommission ?? 0) || 0;
}

function formatProduct(doc) {
  const p = doc.toObject ? doc.toObject() : doc;
  const utilityPrice = resolveUtilityPrice(p);
  const directPrice = resolveDirectPrice(p);
  const agentCommission = resolveAgentCommission(p);
  const managerCommission = resolveManagerCommission(p);

  return {
    _id: p._id,
    sku: p.sku,
    name: p.name,
    utilityPrice,
    directPrice,
    agentCommission,
    managerCommission,
    salesPrice: utilityPrice,
    commission: agentCommission,
    installationCost: p.installationCost ?? 0,
    productType: p.productType || 'Proposed Fixture',
    category: p.category || null,
    isOtherFixture: Boolean(p.isOtherFixture),
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

function parseMoney(value, fieldName) {
  const num = Number(value);
  if (value === undefined || value === null || value === '' || isNaN(num) || num < 0) {
    return { error: `${fieldName} must be a valid non-negative number.` };
  }
  return { value: num };
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildSkuFilter(sku, productType = null) {
  const trimmedSku = sku.trim();
  const skuFilter = { sku: { $regex: new RegExp(`^${escapeRegex(trimmedSku)}$`, 'i') } };
  if (!productType) return skuFilter;
  return { $and: [skuFilter, buildFixtureTypeFilter(productType)] };
}

function generateExistingFixtureSku() {
  return `EF-${new mongoose.Types.ObjectId().toString()}`;
}

function parseProposedProductPayload(body, resolvedFixtureType) {
  const {
    sku,
    name,
    utilityPrice,
    directPrice,
    agentCommission,
    managerCommission,
    installationCost,
    salesPrice,
    commission,
    price,
  } = body;

  if (!sku || !name) {
    return { error: 'SKU and name are required.' };
  }

  const utilityPriceResult = parseMoney(
    utilityPrice !== undefined ? utilityPrice : salesPrice !== undefined ? salesPrice : price,
    'Utility price'
  );
  if (utilityPriceResult.error) {
    return { error: utilityPriceResult.error };
  }

  const directPriceResult = parseMoney(directPrice ?? 0, 'Direct price');
  if (directPriceResult.error) {
    return { error: directPriceResult.error };
  }

  const agentCommissionResult = parseMoney(
    agentCommission !== undefined ? agentCommission : commission ?? 0,
    'Agent commission'
  );
  if (agentCommissionResult.error) {
    return { error: agentCommissionResult.error };
  }

  const managerCommissionResult = parseMoney(managerCommission ?? 0, 'Manager commission');
  if (managerCommissionResult.error) {
    return { error: managerCommissionResult.error };
  }

  const installationCostResult = parseMoney(installationCost ?? 0, 'Installation cost');
  if (installationCostResult.error) {
    return { error: installationCostResult.error };
  }

  return {
    value: {
      sku: sku.trim(),
      name: name.trim(),
      utilityPrice: utilityPriceResult.value,
      directPrice: directPriceResult.value,
      agentCommission: agentCommissionResult.value,
      managerCommission: managerCommissionResult.value,
      salesPrice: utilityPriceResult.value,
      commission: agentCommissionResult.value,
      installationCost: installationCostResult.value,
      productType: resolvedFixtureType,
    },
  };
}

function parseExistingFixturePayload(body, resolvedFixtureType, existingProduct = null) {
  const { name } = body;

  if (!name || !String(name).trim()) {
    return { error: 'Name is required.' };
  }

  return {
    value: {
      sku: existingProduct?.sku || generateExistingFixtureSku(),
      name: String(name).trim(),
      salesPrice: 0,
      commission: 0,
      installationCost: 0,
      productType: resolvedFixtureType,
      isOtherFixture: false,
    },
  };
}

function parseProductPayload(body, existingProduct = null) {
  const resolvedFixtureType =
    resolveFixtureType(body.productType) ||
    resolveFixtureType(existingProduct?.productType);

  if (!resolvedFixtureType) {
    return {
      error: 'Valid productType is required. Use "Proposed Fixture" or "Existing Fixture".',
    };
  }

  if (resolvedFixtureType === 'Existing Fixture') {
    return parseExistingFixturePayload(body, resolvedFixtureType, existingProduct);
  }

  return parseProposedProductPayload(body, resolvedFixtureType);
}

async function findProductBySku(sku, excludeId = null, productType = null) {
  const filter = buildSkuFilter(sku, productType);
  if (excludeId) {
    filter._id = { $ne: excludeId };
  }
  return Product.findOne(filter);
}

async function findProductByName(name, excludeId = null, productType = null) {
  const trimmedName = String(name || '').trim();
  if (!trimmedName) return null;

  const filter = {
    name: { $regex: new RegExp(`^${escapeRegex(trimmedName)}$`, 'i') },
    ...buildFixtureTypeFilter(productType || 'Existing Fixture'),
  };

  if (excludeId) {
    filter._id = { $ne: excludeId };
  }

  return Product.findOne(filter);
}

function roundMoney(value) {
  return Math.round(Number(value) * 100) / 100;
}

function getProposedPrices(product) {
  const p = product.toObject ? product.toObject() : product;
  return {
    utilityPrice: roundMoney(resolveUtilityPrice(p)),
    directPrice: roundMoney(resolveDirectPrice(p)),
    agentCommission: roundMoney(resolveAgentCommission(p)),
    managerCommission: roundMoney(resolveManagerCommission(p)),
    installationCost: roundMoney(Number(p.installationCost ?? 0) || 0),
  };
}

function proposedPricesMatch(a, b) {
  const priceA = getProposedPrices(a);
  const priceB = getProposedPrices(b);
  return (
    priceA.utilityPrice === priceB.utilityPrice &&
    priceA.directPrice === priceB.directPrice &&
    priceA.agentCommission === priceB.agentCommission &&
    priceA.managerCommission === priceB.managerCommission &&
    priceA.installationCost === priceB.installationCost
  );
}

const PROPOSED_NAME_PRICE_MISMATCH_MESSAGE =
  'A product with this name already exists with different prices. Products with the same name must have the same prices.';

async function findProposedProductsByName(name, excludeId = null, productType = 'Proposed Fixture') {
  const trimmedName = String(name || '').trim();
  if (!trimmedName) return [];

  const filter = {
    name: { $regex: new RegExp(`^${escapeRegex(trimmedName)}$`, 'i') },
    ...buildFixtureTypeFilter(productType),
  };

  if (excludeId) {
    filter._id = { $ne: excludeId };
  }

  return Product.find(filter);
}

async function validateProposedNamePriceConsistency(
  name,
  payload,
  excludeId = null,
  productType = 'Proposed Fixture'
) {
  const sameNameProducts = await findProposedProductsByName(name, excludeId, productType);

  for (const existing of sameNameProducts) {
    if (!proposedPricesMatch(payload, existing)) {
      return { error: PROPOSED_NAME_PRICE_MISMATCH_MESSAGE };
    }
  }

  return { ok: true };
}

function applyProductFields(product, payload) {
  product.sku = payload.sku;
  product.name = payload.name;
  product.utilityPrice = payload.utilityPrice;
  product.directPrice = payload.directPrice;
  product.agentCommission = payload.agentCommission;
  product.managerCommission = payload.managerCommission;
  product.salesPrice = payload.salesPrice;
  product.commission = payload.commission;
  product.installationCost = payload.installationCost;
}

function applyExistingFixtureFilter(filter, { includeOther = false, otherOnly = false } = {}) {
  if (otherOnly) {
    filter.isOtherFixture = true;
    return;
  }

  if (!includeOther) {
    const withoutOther = {
      $or: [
        { isOtherFixture: false },
        { isOtherFixture: { $exists: false } },
        { isOtherFixture: null },
      ],
    };

    if (filter.$and) {
      filter.$and.push(withoutOther);
    } else if (filter.$or) {
      filter.$and = [{ $or: filter.$or }, withoutOther];
      delete filter.$or;
    } else {
      Object.assign(filter, withoutOther);
    }
  }
}

exports.listExistingFixtureProducts = async (req, res) => {
  req.query = { ...req.query, productType: 'Existing Fixture', includeOther: 'true' };
  return exports.listProducts(req, res);
};

exports.listOtherFixtureProducts = async (req, res) => {
  req.query = { ...req.query, productType: 'Existing Fixture', otherOnly: 'true' };
  return exports.listProducts(req, res);
};

exports.listProducts = async (req, res) => {
  try {
    const { productType, type, category } = req.query;
    const includeOther = String(req.query.includeOther || '').toLowerCase() === 'true';
    const otherOnly = String(req.query.otherOnly || '').toLowerCase() === 'true';

    const filter = {};
    const requestedFixtureType = resolveFixtureType(productType);

    if (productType !== undefined && productType !== null && String(productType).trim() !== '') {
      if (!requestedFixtureType) {
        return res.status(400).json({
          message: 'Invalid productType.',
          allowedTypes: FIXTURE_TYPES,
        });
      }
      Object.assign(filter, buildFixtureTypeFilter(requestedFixtureType));

      if (requestedFixtureType === 'Existing Fixture') {
        applyExistingFixtureFilter(filter, { includeOther, otherOnly });
      }
    }

    const requestedCategory = (category ?? (requestedFixtureType ? '' : type) ?? '')
      .toString()
      .trim();

    if (requestedCategory) {
      const matchedCategory =
        CATEGORIES.find((c) => c.toLowerCase() === requestedCategory.toLowerCase()) ||
        null;

      if (!matchedCategory) {
        return res.status(400).json({
          message: 'Invalid product category.',
          allowedCategories: CATEGORIES,
        });
      }

      filter.category = matchedCategory;
    }

    const products = await Product.find(filter).sort({ createdAt: -1 });
    const formatted = products.map(formatProduct);

    return res.status(200).json({
      products: formatted,
      total: formatted.length,
    });
  } catch (error) {
    console.error('List products error:', error);
    return res.status(500).json({ message: 'Server error listing products.' });
  }
};

exports.createProduct = async (req, res) => {
  try {
    const parsed = parseProductPayload(req.body);

    if (parsed.error) {
      return res.status(400).json({ message: parsed.error });
    }

    if (parsed.value.productType === 'Existing Fixture') {
      const existingName = await findProductByName(
        parsed.value.name,
        null,
        parsed.value.productType
      );
      if (existingName) {
        return res.status(400).json({
          message: 'A product with this name already exists.',
        });
      }
    } else {
      const existingSku = await findProductBySku(
        parsed.value.sku,
        null,
        parsed.value.productType
      );
      if (existingSku) {
        return res.status(400).json({
          message: 'A product with this SKU already exists for this fixture type.',
        });
      }

      const namePriceCheck = await validateProposedNamePriceConsistency(
        parsed.value.name,
        parsed.value,
        null,
        parsed.value.productType
      );
      if (namePriceCheck.error) {
        return res.status(400).json({ message: namePriceCheck.error });
      }
    }

    const product = await Product.create(parsed.value);

    if (req.user?.id) {
      await createLog('Product Created', req.user.id, product.name, 'Product', product._id);
    }

    return res.status(201).json({
      message: 'Product created successfully.',
      product: formatProduct(product),
      action: 'created',
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({
        message: 'A product with this SKU already exists for this fixture type.',
      });
    }
    console.error('Create product error:', error);
    return res.status(500).json({ message: 'Server error creating product.' });
  }
};

exports.updateProduct = async (req, res) => {
  try {
    const { id } = req.params;
    const product = await Product.findById(id);
    if (!product) {
      return res.status(404).json({ message: 'Product not found.' });
    }

    const parsed = parseProductPayload(req.body, product);

    if (parsed.error) {
      return res.status(400).json({ message: parsed.error });
    }

    const fixtureType = product.productType || parsed.value.productType;

    if (fixtureType === 'Existing Fixture') {
      const existingName = await findProductByName(parsed.value.name, id, fixtureType);
      if (existingName) {
        return res.status(400).json({ message: 'A product with this name already exists.' });
      }

      product.name = parsed.value.name;
    } else {
      const existingSku = await findProductBySku(parsed.value.sku, id, fixtureType);
      if (existingSku) {
        return res.status(400).json({ message: 'A product with this SKU already exists.' });
      }

      const namePriceCheck = await validateProposedNamePriceConsistency(
        parsed.value.name,
        parsed.value,
        id,
        fixtureType
      );
      if (namePriceCheck.error) {
        return res.status(400).json({ message: namePriceCheck.error });
      }

      applyProductFields(product, parsed.value);
    }
    await product.save();

    if (req.user?.id) {
      await createLog('Product Updated', req.user.id, product.name, 'Product', product._id);
    }

    return res.status(200).json({
      message: 'Product updated successfully.',
      product: formatProduct(product),
      action: 'updated',
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ message: 'A product with this SKU already exists.' });
    }
    console.error('Update product error:', error);
    return res.status(500).json({ message: 'Server error updating product.' });
  }
};

exports.getProduct = async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) {
      return res.status(404).json({ message: 'Product not found.' });
    }
    return res.status(200).json({ product: formatProduct(product) });
  } catch (error) {
    console.error('Get product error:', error);
    return res.status(500).json({ message: 'Server error fetching product.' });
  }
};

exports.deleteProduct = async (req, res) => {
  try {
    const { id } = req.params;
    const product = await Product.findById(id);

    if (!product) {
      return res.status(404).json({ message: 'Product not found.' });
    }

    if (!product.isOtherFixture) {
      return res.status(400).json({
        message: 'Only other fixtures can be deleted from the other fixtures list.',
      });
    }

    const inUse = await Survey.exists({
      'areas.fixtures.product_id': product._id,
    });

    if (inUse) {
      return res.status(400).json({
        message:
          'This other fixture is used in one or more surveys and cannot be deleted.',
      });
    }

    await Product.findByIdAndDelete(id);

    if (req.user?.id) {
      await createLog('Other Fixture Deleted', req.user.id, product.name, 'Product', product._id);
    }

    return res.status(200).json({
      message: 'Other fixture deleted successfully.',
    });
  } catch (error) {
    console.error('Delete product error:', error);
    return res.status(500).json({ message: 'Server error deleting product.' });
  }
};
