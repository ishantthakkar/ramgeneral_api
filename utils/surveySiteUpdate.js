const Survey = require('../models/Survey');
const { tryParseJson } = require('./subdocumentHelpers');

const SITE_ROW_KEY = /^([a-f0-9]{24})-(\d+)$/i;
const NA_VALUES = new Set(['N/A', '—', '-', '']);

/**
 * Admin workflow edit sends rows with _id "{surveyId}-{areaIndex}".
 */
function parseSiteRowKey(rowId) {
  if (!rowId) return null;
  const match = String(rowId).trim().match(SITE_ROW_KEY);
  if (!match) return null;
  return { surveyId: match[1], index: Number(match[2], 10) };
}

function parseHeightDisplay(value) {
  const text = (value ?? '').toString().trim();
  if (!text || text === 'N/A') {
    return { heightFt: '', heightIn: '' };
  }

  const ftMatch = text.match(/(\d+)\s*'/);
  const inMatch = text.match(/(\d+)\s*"/);

  return {
    heightFt: ftMatch ? ftMatch[1] : '',
    heightIn: inMatch ? inMatch[1] : '',
  };
}

function normalizeDisplayField(value) {
  const text = (value ?? '').toString().trim();
  if (NA_VALUES.has(text)) return '';
  return text;
}

function normalizePrice(value) {
  const text = normalizeDisplayField(value);
  return text.replace(/^\$/, '');
}

function toStoredImageName(img) {
  const raw = (img ?? '').toString().trim();
  if (!raw) return '';

  if (!raw.includes('/')) {
    return raw.replace(/^\//, '');
  }

  try {
    const pathname = new URL(raw).pathname;
    return pathname.split('/').filter(Boolean).pop() || raw;
  } catch {
    return raw.split('/').filter(Boolean).pop() || raw;
  }
}

function toStoredImageNames(images) {
  if (!Array.isArray(images)) return [];
  return images.map(toStoredImageName).filter(Boolean);
}

function mapSiteRowToArea(row, existingArea = {}) {
  const existing =
    existingArea && typeof existingArea === 'object'
      ? existingArea.toObject
        ? existingArea.toObject()
        : existingArea
      : {};

  const { heightFt, heightIn } = parseHeightDisplay(
    row.heightInInches ?? row.height ?? row.heightFt
  );

  const imagesFromRow = toStoredImageNames(row.images);
  const images =
    imagesFromRow.length > 0 ? imagesFromRow : existing.images || [];

  return {
    areaName:
      normalizeDisplayField(row.area ?? row.areaName) ||
      existing.areaName ||
      '',
    product_id: existing.product_id || existing.productId || null,
    heightFt: heightFt || existing.heightFt || '',
    heightIn: heightIn || existing.heightIn || '',
    existingBulbs:
      normalizeDisplayField(row.existingBulbs) || existing.existingBulbs || '',
    existingFixtureType:
      normalizeDisplayField(row.existingFixtureType) ||
      existing.existingFixtureType ||
      '',
    note: (row.note ?? '').toString().trim(),
    existingQty:
      normalizeDisplayField(row.existingQuantity ?? row.existingQty) ||
      existing.existingQty ||
      '',
    proposedQty:
      normalizeDisplayField(row.proposedQuantity ?? row.proposedQty) ||
      existing.proposedQty ||
      '',
    price:
      normalizePrice(row.pricePerUnit ?? row.price) || existing.price || '',
    images,
  };
}

/**
 * Persists admin site-detail table rows onto Survey.areas[].
 * @param {string} customerId
 * @param {unknown} surveysPayload - SiteDetailRow[] from admin UI
 */
async function applySurveySiteUpdates(customerId, surveysPayload) {
  const rows = tryParseJson(surveysPayload);
  if (!Array.isArray(rows) || rows.length === 0) {
    return { updated: 0 };
  }

  const customerIdStr = customerId.toString();
  const grouped = new Map();

  for (const row of rows) {
    const key = parseSiteRowKey(row._id);
    if (!key) continue;

    if (!grouped.has(key.surveyId)) {
      grouped.set(key.surveyId, []);
    }
    grouped.get(key.surveyId).push({ row, index: key.index });
  }

  let updated = 0;

  for (const [surveyId, items] of grouped) {
    items.sort((a, b) => a.index - b.index);

    const survey = await Survey.findById(surveyId);
    if (!survey) continue;
    if (survey.customer_id?.toString() !== customerIdStr) continue;

    const existingAreas = survey.areas || [];
    const newAreas = items.map(({ row, index }) =>
      mapSiteRowToArea(row, existingAreas[index] || {})
    );

    survey.areas = newAreas;
    survey.markModified('areas');

    if (newAreas.length === 1) {
      survey.areaName = newAreas[0].areaName || survey.areaName;
      if (newAreas[0].note) {
        survey.note = newAreas[0].note;
      }
    }

    await survey.save({ validateModifiedOnly: true });
    updated += 1;
  }

  return { updated };
}

module.exports = {
  applySurveySiteUpdates,
  mapSiteRowToArea,
  parseSiteRowKey,
};
