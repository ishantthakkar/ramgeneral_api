const tryParseJson = (value) => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed) return value;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
};

const getSubdocId = (item) => {
  if (!item) return null;
  if (item.id) return String(item.id);
  if (item._id) return String(item._id);
  return null;
};

const toPlainSubdocs = (items) =>
  (Array.isArray(items) ? items : []).map((doc) =>
    doc && typeof doc.toObject === 'function' ? doc.toObject() : { ...doc }
  );

const mergeSubdocuments = (existing, incoming) => {
  const result = toPlainSubdocs(existing);

  for (const item of incoming) {
    const itemId = getSubdocId(item);
    const { id, _id, ...fields } = item;

    if (itemId) {
      const index = result.findIndex(
        (r) => String(r._id) === itemId || String(r.id) === itemId
      );
      if (index >= 0) {
        result[index] = {
          ...result[index],
          ...fields,
          _id: result[index]._id,
          createdAt: result[index].createdAt || fields.createdAt || new Date(),
        };
        continue;
      }
    }

    result.push({
      ...fields,
      createdAt: fields.createdAt || new Date(),
    });
  }

  return result;
};

const normalizeAddresses = (addresses) => {
  if (addresses === undefined || addresses === null) return null;
  const parsed = tryParseJson(addresses);
  if (!Array.isArray(parsed)) return null;
  return parsed
    .filter(Boolean)
    .map((a) => {
      const subdocId = getSubdocId(a);
      return {
        ...(subdocId ? { id: subdocId } : {}),
        title: (a.title ?? a.label ?? '').toString().trim(),
        street: (a.street ?? '').toString().trim(),
        city: (a.city ?? '').toString().trim(),
        state: (a.state ?? '').toString().trim(),
        zip: (a.zip ?? '').toString().trim(),
        ...(a.createdAt ? { createdAt: new Date(a.createdAt) } : {}),
      };
    });
};

const normalizeBillFilenames = (value) => {
  if (!value) return [];
  const parsed = tryParseJson(value);
  if (Array.isArray(parsed)) {
    return parsed.map((f) => String(f).trim()).filter(Boolean);
  }
  if (typeof parsed === 'string' && parsed.trim()) {
    return [parsed.trim()];
  }
  return [];
};

const normalizeBusinessCardFilenames = (value) => normalizeBillFilenames(value);

const parseContactBusinessCardField = (fieldname) => {
  const field = String(fieldname || '').trim();
  let match = field.match(/^contact_(?:business_card|bussiness_card)_(\d+)$/i);
  if (match) return Number(match[1], 10);
  match = field.match(/^contact_(\d+)_(?:business_card|bussiness_card)$/i);
  if (match) return Number(match[1], 10);
  return null;
};

const resolveContactBusinessCardUploads = (req) => {
  const byContactIdx = {};
  for (const file of req.files || []) {
    const contactIdx = parseContactBusinessCardField(file.fieldname);
    if (contactIdx === null) continue;
    if (!byContactIdx[contactIdx]) byContactIdx[contactIdx] = [];
    byContactIdx[contactIdx].push(file.filename);
  }
  return byContactIdx;
};

const attachBusinessCardsToContactInfo = (contactInfo, uploadsByIdx = {}) => {
  if (!Array.isArray(contactInfo)) return contactInfo;
  return contactInfo.map((contact, idx) => {
    const uploaded = uploadsByIdx[idx] || [];
    const fromJson = normalizeBusinessCardFilenames(
      contact.businessCard ?? contact.bussinessCard
    );
    const businessCard = [...new Set([...fromJson, ...uploaded].filter(Boolean))];
    return { ...contact, businessCard };
  });
};

const appendBusinessCardsToContactInfo = (contactInfo, uploadsByIdx = {}) => {
  if (!Array.isArray(contactInfo)) return contactInfo;
  return contactInfo.map((contact, idx) => {
    const uploaded = uploadsByIdx[idx] || [];
    if (!uploaded.length) return contact;
    const existing = normalizeBusinessCardFilenames(
      contact.businessCard ?? contact.bussinessCard
    );
    return {
      ...contact,
      businessCard: [...new Set([...existing, ...uploaded].filter(Boolean))],
    };
  });
};

const normalizeContactInfo = (contactInfo) => {
  if (contactInfo === undefined || contactInfo === null) return null;
  const parsed = tryParseJson(contactInfo);
  if (!Array.isArray(parsed)) return null;
  return parsed
    .filter(Boolean)
    .map((c) => {
      const subdocId = getSubdocId(c);
      return {
        ...(subdocId ? { id: subdocId } : {}),
        position: (c.position ?? '').toString().trim(),
        department: (c.department ?? '').toString().trim(),
        name: (c.name ?? '').toString().trim(),
        phone: (c.phone ?? '').toString().trim(),
        mobile: (c.mobile ?? '').toString().trim(),
        email: (c.email ?? '').toString().trim().toLowerCase(),
        businessCard: normalizeBusinessCardFilenames(c.businessCard ?? c.bussinessCard),
        ...(c.createdAt ? { createdAt: new Date(c.createdAt) } : {}),
      };
    });
};

const normalizeNotes = (notes) => {
  if (notes === undefined || notes === null) return [];
  const parsed = tryParseJson(notes);
  if (Array.isArray(parsed)) {
    return parsed.filter(Boolean).map((n) => {
      if (typeof n === 'string') {
        return { title: '', note: n.trim(), createdAt: new Date() };
      }
      return {
        title: (n.title ?? '').toString().trim(),
        note: (n.note ?? '').toString().trim(),
        createdAt: n.createdAt ? new Date(n.createdAt) : new Date(),
      };
    });
  }
  if (typeof parsed === 'object' && parsed !== null) {
    return [
      {
        title: (parsed.title ?? '').toString().trim(),
        note: (parsed.note ?? '').toString().trim(),
        createdAt: parsed.createdAt ? new Date(parsed.createdAt) : new Date(),
      },
    ];
  }
  if (typeof parsed === 'string' && parsed.trim()) {
    return [{ title: '', note: parsed.trim(), createdAt: new Date() }];
  }
  return [];
};

const normalizeActivityLog = (activityLog) => {
  if (activityLog === undefined || activityLog === null) return null;
  const parsed = tryParseJson(activityLog);
  if (!Array.isArray(parsed)) return null;
  return parsed.filter(Boolean).map((a) => ({
    ...(getSubdocId(a) ? { id: getSubdocId(a) } : {}),
    activityType: (a.activityType ?? '').toString().trim(),
    date: a.date ? new Date(a.date) : new Date(),
    outcome: (a.outcome ?? '').toString().trim(),
    notes: (a.notes ?? '').toString().trim(),
    followUpDate: a.followUpDate ? new Date(a.followUpDate) : undefined,
    nextFollowUpDate: a.nextFollowUpDate ? new Date(a.nextFollowUpDate) : undefined,
    createdAt: a.createdAt ? new Date(a.createdAt) : new Date(),
  }));
};

const resolveNewBillFilenames = (req, uploadElectricityBill, upload_electricity_bill) => {
  const billFieldNames = new Set(['upload_electricity_bill', 'uploadElectricityBill']);
  const fromFiles = (req.files && Array.isArray(req.files) ? req.files : [])
    .filter((f) => billFieldNames.has(f.fieldname))
    .map((f) => f.filename);
  const fromBody = [
    ...normalizeBillFilenames(uploadElectricityBill),
    ...normalizeBillFilenames(upload_electricity_bill),
  ];
  return [...new Set([...fromFiles, ...fromBody])];
};

module.exports = {
  tryParseJson,
  mergeSubdocuments,
  normalizeAddresses,
  normalizeContactInfo,
  normalizeNotes,
  normalizeActivityLog,
  normalizeBillFilenames,
  normalizeBusinessCardFilenames,
  parseContactBusinessCardField,
  resolveContactBusinessCardUploads,
  attachBusinessCardsToContactInfo,
  appendBusinessCardsToContactInfo,
  resolveNewBillFilenames,
};
