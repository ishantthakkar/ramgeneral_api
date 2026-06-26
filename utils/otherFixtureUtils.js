const mongoose = require('mongoose');
const Product = require('../models/Product');
const { buildFixtureTypeFilter } = require('./productUtils');

const OTHER_FIXTURE_LABELS = new Set(['other', 'others', 'other fixture', 'other fixtures']);

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isOtherFixtureSelection(value) {
  return OTHER_FIXTURE_LABELS.has(String(value || '').trim().toLowerCase());
}

function resolveOtherFixtureName(fixture) {
  const plain = fixture?.toObject ? fixture.toObject() : fixture || {};

  const explicit =
    plain.otherFixtureName ??
    plain.other_fixture_name ??
    plain.otherFixture ??
    plain.other_fixture;

  if (explicit && String(explicit).trim()) {
    return String(explicit).trim();
  }

  const fixtureType = String(plain.existingFixtureType || '').trim();
  if (isOtherFixtureSelection(fixtureType)) {
    const noteName = String(plain.note || '').trim();
    return noteName || null;
  }

  return null;
}

function collectOtherFixtureNames(areas) {
  const names = new Set();
  if (!Array.isArray(areas)) return names;

  for (const area of areas) {
    const fixtures = Array.isArray(area.fixtures)
      ? area.fixtures
      : area.product_id
        ? [area]
        : [];

    for (const fixture of fixtures) {
      const name = resolveOtherFixtureName(fixture);
      if (name) names.add(name);
    }
  }

  return names;
}

function generateExistingFixtureSku() {
  return `EF-${new mongoose.Types.ObjectId().toString()}`;
}

async function findExistingFixtureByName(name) {
  const trimmed = String(name || '').trim();
  if (!trimmed) return null;

  return Product.findOne({
    name: { $regex: new RegExp(`^${escapeRegex(trimmed)}$`, 'i') },
    ...buildFixtureTypeFilter('Existing Fixture'),
  });
}

async function upsertOtherFixtureProduct(name) {
  const trimmed = String(name || '').trim();
  if (!trimmed) return null;

  const existing = await findExistingFixtureByName(trimmed);
  if (existing) {
    return existing;
  }

  return Product.create({
    sku: generateExistingFixtureSku(),
    name: trimmed,
    salesPrice: 0,
    commission: 0,
    installationCost: 0,
    productType: 'Existing Fixture',
    isOtherFixture: true,
  });
}

async function syncOtherFixturesFromAreas(areas) {
  const names = collectOtherFixtureNames(areas);
  const results = [];

  for (const name of names) {
    const product = await upsertOtherFixtureProduct(name);
    if (product) results.push(product);
  }

  return results;
}

module.exports = {
  OTHER_FIXTURE_LABELS,
  isOtherFixtureSelection,
  resolveOtherFixtureName,
  collectOtherFixtureNames,
  upsertOtherFixtureProduct,
  syncOtherFixturesFromAreas,
};
