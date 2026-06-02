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
    const { sku, name, salesPrice, commission, installationCost, price } = req.body;

    if (!sku || !name) {
      return res.status(400).json({ message: 'SKU and name are required.' });
    }

    const salesPriceResult = parseMoney(
      salesPrice !== undefined ? salesPrice : price,
      'Sales price'
    );
    if (salesPriceResult.error) {
      return res.status(400).json({ message: salesPriceResult.error });
    }

    const commissionResult = parseMoney(commission ?? 0, 'Commission');
    if (commissionResult.error) {
      return res.status(400).json({ message: commissionResult.error });
    }

    const installationCostResult = parseMoney(installationCost ?? 0, 'Installation cost');
    if (installationCostResult.error) {
      return res.status(400).json({ message: installationCostResult.error });
    }

    const existingSku = await Product.findOne({ sku: sku.trim() });
    if (existingSku) {
      return res.status(400).json({ message: 'A product with this SKU already exists.' });
    }

    const product = await Product.create({
      sku: sku.trim(),
      name: name.trim(),
      salesPrice: salesPriceResult.value,
      commission: commissionResult.value,
      installationCost: installationCostResult.value,
    });

    if (req.user?.id) {
      await createLog('Product Created', req.user.id, product.name, 'Product', product._id);
    }

    return res.status(201).json({
      message: 'Product created successfully.',
      product: formatProduct(product),
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ message: 'A product with this SKU already exists.' });
    }
    console.error('Create product error:', error);
    return res.status(500).json({ message: 'Server error creating product.' });
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
