// Regenerate usa-states.json: npm install @mardillu/us-cities-utils && node scripts/build-usa-states.js
const fs = require('fs');
const path = require('path');
const { getStates, getZipcodes } = require('@mardillu/us-cities-utils');

const states = getStates().map((state) => {
  const entries = getZipcodes(state.nameAbbr);
  const cityMap = new Map();

  for (const entry of entries) {
    const cityName = entry.name.trim();
    if (!cityMap.has(cityName)) {
      cityMap.set(cityName, new Set());
    }
    cityMap.get(cityName).add(entry.zip);
  }

  const cities = [...cityMap.entries()]
    .map(([name, zips]) => ({
      name,
      zip: [...zips].sort(),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    code: state.nameAbbr,
    name: state.name,
    cities,
  };
});

const outputPath = path.join(__dirname, '..', 'usa-states.json');
fs.writeFileSync(outputPath, JSON.stringify({ states }, null, 2));

const cityCount = states.reduce((n, s) => n + s.cities.length, 0);
const zipCount = states.reduce(
  (n, s) => n + s.cities.reduce((m, c) => m + c.zip.length, 0),
  0
);
console.log(`Wrote ${outputPath}`);
console.log(`${states.length} states, ${cityCount} cities, ${zipCount} zip entries`);
