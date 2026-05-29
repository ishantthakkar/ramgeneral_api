const LEAD_SOURCES = [
  { code: 'CC', name: 'Cold Call' },
  { code: 'CA', name: 'Company Appointment' },
  { code: 'WI', name: 'Walk-In' },
  { code: 'TW', name: 'Twitter' },
  { code: 'FB', name: 'Facebook' },
  { code: 'IG', name: 'Instagram' },
  { code: 'WA', name: 'Whatsapp' },
  { code: 'WB', name: 'Website' },
  { code: 'YL', name: 'Yelp' },
  { code: 'YP', name: 'Yellow Pages' },
];

const LEAD_SOURCE_CODES = Object.fromEntries(
  LEAD_SOURCES.map(({ code, name }) => [code, name])
);

const LEAD_SOURCE_CODE_LIST = LEAD_SOURCES.map((s) => s.code);

const resolveLeadSourceCode = (leadSource) => {
  if (!leadSource) return null;
  const trimmed = leadSource
    .toString()
    .trim()
    .replace(/^["']+|["']+$/g, '');
  const code = trimmed.toUpperCase();
  if (LEAD_SOURCE_CODES[code]) return code;

  const byName = LEAD_SOURCES.find(
    (s) => s.name.toLowerCase() === trimmed.toLowerCase()
  );
  return byName ? byName.code : null;
};

const getLeadSourceName = (code) => LEAD_SOURCE_CODES[code] || '';

module.exports = {
  LEAD_SOURCES,
  LEAD_SOURCE_CODES,
  LEAD_SOURCE_CODE_LIST,
  resolveLeadSourceCode,
  getLeadSourceName,
};
