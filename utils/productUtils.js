const { FIXTURE_TYPES, ACCESSORY_TYPES } = require('../models/Product');

function resolveFixtureType(value) {
  const requested = (value ?? '').toString().trim();
  if (!requested) return null;
  return (
    FIXTURE_TYPES.find((type) => type.toLowerCase() === requested.toLowerCase()) || null
  );
}

function resolveAccessoryType(value) {
  const requested = (value ?? '').toString().trim();
  if (!requested) return null;
  return (
    ACCESSORY_TYPES.find((type) => type.toLowerCase() === requested.toLowerCase()) || null
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

module.exports = {
  FIXTURE_TYPES,
  ACCESSORY_TYPES,
  resolveFixtureType,
  resolveAccessoryType,
  buildFixtureTypeFilter,
};
