const Product = require('../models/Product');
const { createLog } = require('../utils/logger');
const { CATEGORIES } = require('../models/Product');

function formatProduct(doc) {
  const p = doc.toObject ? doc.toObject() : doc;
  return {
    _id: p._id,
    sku: p.sku,
    name: p.name,
    salesPrice: p.salesPrice ?? p.price ?? 0,
    commission: p.commission ?? 0,
    installationCost: p.installationCost ?? 0,
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

function buildSkuFilter(sku) {
  const trimmedSku = sku.trim();
  return { sku: { $regex: new RegExp(`^${escapeRegex(trimmedSku)}$`, 'i') } };
}

function parseProductPayload(body) {
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
    },
  };
}

async function findProductBySku(sku, excludeId = null) {
  const filter = buildSkuFilter(sku);
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
    const { type, category } = req.query;

    const filter = {};
    const requestedType = (type ?? category ?? '').toString().trim();

    if (requestedType) {
      const matchedCategory =
        CATEGORIES.find((c) => c.toLowerCase() === requestedType.toLowerCase()) ||
        null;

      if (!matchedCategory) {
        return res.status(400).json({
          message: 'Invalid product type.',
          allowedTypes: CATEGORIES,
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
        message:
          'Could not create product because SKU is still unique in the database. Restart the API server to apply the latest product index settings.',
      });
    }
    console.error('Create product error:', error);
    return res.status(500).json({ message: 'Server error creating product.' });
  }
};

exports.updateProduct = async (req, res) => {
  try {
    const { id } = req.params;
    const parsed = parseProductPayload(req.body);

    if (parsed.error) {
      return res.status(400).json({ message: parsed.error });
    }

    const product = await Product.findById(id);
    if (!product) {
      return res.status(404).json({ message: 'Product not found.' });
    }

    const existingSku = await findProductBySku(parsed.value.sku, id);
    if (existingSku) {
      return res.status(400).json({ message: 'A product with this SKU already exists.' });
    }

    applyProductFields(product, parsed.value);
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
