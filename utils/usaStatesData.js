const fs = require('fs');
const path = require('path');

const USA_STATES_PATH = path.join(__dirname, '..', 'usa-states.json');

let cachedApiData = null;
let cachedStateIndex = null;

function loadRawStates() {
  const raw = fs.readFileSync(USA_STATES_PATH, 'utf8');
  const parsed = JSON.parse(raw);
  if (!parsed?.states || !Array.isArray(parsed.states)) {
    throw new Error('usa-states.json must contain a "states" array.');
  }
  return parsed.states;
}

function toApiEntry(stateRow) {
  return {
    state: stateRow.name,
    cities: (stateRow.cities || []).map((cityRow) => ({
      city: cityRow.name,
      zip: cityRow.zip || [],
    })),
  };
}

function buildCache() {
  const states = loadRawStates();
  cachedApiData = states.map(toApiEntry);
  cachedStateIndex = new Map();
  for (const row of states) {
    cachedStateIndex.set(row.code.toUpperCase(), row);
    cachedStateIndex.set(row.name.toLowerCase(), row);
  }
}

function ensureCache() {
  if (!cachedApiData) {
    buildCache();
  }
}

function getAllUsaStates() {
  ensureCache();
  return cachedApiData;
}

function resolveStateRow(stateQuery) {
  if (!stateQuery || typeof stateQuery !== 'string') return null;
  ensureCache();
  const trimmed = stateQuery.trim();
  if (!trimmed) return null;
  return (
    cachedStateIndex.get(trimmed.toUpperCase()) ||
    cachedStateIndex.get(trimmed.toLowerCase()) ||
    null
  );
}

function getUsaStateByQuery(stateQuery) {
  const row = resolveStateRow(stateQuery);
  return row ? toApiEntry(row) : null;
}

module.exports = {
  getAllUsaStates,
  getUsaStateByQuery,
  resolveStateRow,
};
