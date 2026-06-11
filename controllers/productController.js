const mongoose = require('mongoose');
const Product = require('../models/Product');
const { createLog } = require('../utils/logger');
const { CATEGORIES, FIXTURE_TYPES } = require('../models/Product');

function formatProduct(doc) {
  const p = doc.toObject ? doc.toObject() : doc;
  return {
    _id: p._id,
    sku: p.sku,
    name: p.name,
    salesPrice: p.salesPrice ?? p.price ?? 0,
    commission: p.commission ?? 0,
    installationCost: p.installationCost ?? 0,
    productType: p.productType || 'Proposed Fixture',
    category: p.category || null,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

function resolveFixtureType(value) {
  const requested = (value ?? '').toString().trim();
  if (!requested) return null;
  return (
    FIXTURE_TYPES.find((type) => type.toLowerCase() === requested.toLowerCase()) || null
  );
}

function buildFixtureTypeFilter(fixtureType) {
  if (fixtureType === 'Proposed Fixture') {
    return {
      $or: [
        { productType: 'Proposed Fixture' },
        { productType: { $exists: false } },
        { productType: null },
        { productType: '' },
      ],
    };
  }
  return { productType: fixtureType };
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
  const { sku, name, salesPrice, commission, installationCost, price } = body;

  if (!sku || !name) {
    return { error: 'SKU and name are required.' };
  }

  const salesPriceResult = parseMoney(
    salesPrice !== undefined ? salesPrice : price,
    'Sales price'
  );
  if (salesPriceResult.error) {
    return { error: salesPriceResult.error };
  }

  const commissionResult = parseMoney(commission ?? 0, 'Commission');
  if (commissionResult.error) {
    return { error: commissionResult.error };
  }

  const installationCostResult = parseMoney(installationCost ?? 0, 'Installation cost');
  if (installationCostResult.error) {
    return { error: installationCostResult.error };
  }

  return {
    value: {
      sku: sku.trim(),
      name: name.trim(),
      salesPrice: salesPriceResult.value,
      commission: commissionResult.value,
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

function applyProductFields(product, payload) {
  product.sku = payload.sku;
  product.name = payload.name;
  product.salesPrice = payload.salesPrice;
  product.commission = payload.commission;
  product.installationCost = payload.installationCost;
}

exports.listProducts = async (req, res) => {
  try {
    const { productType, type, category } = req.query;

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
