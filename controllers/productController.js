const Product = require('../models/Product');
const { CATEGORIES } = require('../models/Product');
const { createLog } = require('../utils/logger');

exports.listProducts = async (req, res) => {
  try {
    const { category } = req.query;
    const filter = {};

    if (category && category !== 'all' && CATEGORIES.includes(category)) {
      filter.category = category;
    }

    const products = await Product.find(filter).sort({ createdAt: -1 });

    const counts = {
      total: await Product.countDocuments({}),
    };
    for (const cat of CATEGORIES) {
      counts[cat] = await Product.countDocuments({ category: cat });
    }

    return res.status(200).json({ products, counts });
  } catch (error) {
    console.error('List products error:', error);
    return res.status(500).json({ message: 'Server error listing products.' });
  }
};

exports.createProduct = async (req, res) => {
  try {
    const { sku, name, price, category } = req.body;

    if (!sku || !name || price === undefined || price === null || !category) {
      return res.status(400).json({ message: 'SKU, name, price, and category are required.' });
    }

    if (!CATEGORIES.includes(category)) {
      return res.status(400).json({ message: 'Invalid category.' });
    }

    const priceNum = Number(price);
    if (isNaN(priceNum) || priceNum < 0) {
      return res.status(400).json({ message: 'Price must be a valid non-negative number.' });
    }

    const existingSku = await Product.findOne({ sku: sku.trim() });
    if (existingSku) {
      return res.status(400).json({ message: 'A product with this SKU already exists.' });
    }

    const product = await Product.create({
      sku: sku.trim(),
      name: name.trim(),
      price: priceNum,
      category,
    });

    if (req.user?.id) {
      await createLog(
        'Product Created',
        req.user.id,
        product.name,
        'Product',
        product._id
      );
    }

    return res.status(201).json({
      message: 'Product created successfully.',
      product,
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
    return res.status(200).json({ product });
  } catch (error) {
    console.error('Get product error:', error);
    return res.status(500).json({ message: 'Server error fetching product.' });
  }
};
