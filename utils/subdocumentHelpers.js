const API_BASE_URL = process.env.API_BASE_URL || 'https://ramgeneral-api.onrender.com';

const toBusinessCardUrl = (filename) => {
  if (!filename) return '';
  const value = String(filename).trim();
  if (!value) return '';
  if (value.startsWith('http')) return value;
  return `${API_BASE_URL}/uploads/leads/business-cards/${value.replace(/^\//, '')}`;
};

const formatContactForResponse = (contact) => {
  const plain = contact?.toObject ? contact.toObject() : { ...contact };
  const businessCardFilenames = normalizeBusinessCardFilenames(
    plain.businessCard ?? plain.bussinessCard
  );

  return {
    _id: plain._id,
    position: plain.position || '',
    department: plain.department || '',
    name: plain.name || '',
    phone: plain.phone || '',
    mobile: plain.mobile || '',
    email: plain.email || '',
    businessCard: businessCardFilenames.map(toBusinessCardUrl).filter(Boolean),
    createdAt: plain.createdAt,
  };
};

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

const normalizeAddressEntry = (entry) => {
  if (!entry || typeof entry !== 'object') return null;
  const subdocId = getSubdocId(entry);
  return {
    ...(subdocId ? { id: subdocId } : {}),
    title: (entry.title ?? entry.label ?? '').toString().trim(),
    street: (entry.street ?? '').toString().trim(),
    city: (entry.city ?? '').toString().trim(),
    state: (entry.state ?? '').toString().trim(),
    zip: (entry.zip ?? '').toString().trim(),
    ...(entry.createdAt ? { createdAt: new Date(entry.createdAt) } : {}),
  };
};

const normalizeAddresses = (addresses) => {
  if (addresses === undefined || addresses === null) return null;
  const parsed = tryParseJson(addresses);
  if (!Array.isArray(parsed)) return null;
  return parsed.map(normalizeAddressEntry).filter(Boolean);
};

const parseAddressInput = (body = {}) => {
  const { addresses, address, id, _id, addressId } = body;

  if (addresses !== undefined || address !== undefined) {
    const parsed = tryParseJson(addresses ?? address);
    if (Array.isArray(parsed)) {
      const error = new Error('Send a single address object, not an array.');
      error.code = 'ADDRESS_ARRAY_NOT_ALLOWED';
      throw error;
    }
    if (parsed && typeof parsed === 'object') {
      const one = normalizeAddressEntry(parsed);
      return one ? [one] : [];
    }
    return null;
  }

  const hasAddressField =
    id !== undefined ||
    _id !== undefined ||
    addressId !== undefined ||
    ['title', 'label', 'street', 'city', 'state', 'zip'].some((field) => body[field] !== undefined);

  if (!hasAddressField) return null;

  const one = normalizeAddressEntry({
    id: id ?? _id ?? addressId,
    title: body.title ?? body.label,
    street: body.street,
    city: body.city,
    state: body.state,
    zip: body.zip,
    createdAt: body.createdAt,
  });

  return one ? [one] : [];
};

const formatAddressForResponse = (address) => {
  const plain = address?.toObject ? address.toObject() : { ...address };
  return {
    _id: plain._id,
    title: plain.title || plain.label || '',
    street: plain.street || '',
    city: plain.city || '',
    state: plain.state || '',
    zip: plain.zip || '',
    createdAt: plain.createdAt,
  };
};

const upsertAddresses = (existingAddresses, incomingAddresses) => {
  const result = toPlainSubdocs(existingAddresses);
  const saved = [];

  incomingAddresses.forEach((address) => {
    const addressId = getSubdocId(address);
    const { id, _id, ...fields } = address;

    if (addressId) {
      const index = result.findIndex(
        (r) => String(r._id) === addressId || String(r.id) === addressId
      );
      if (index < 0) {
        const error = new Error(`Address not found: ${addressId}`);
        error.code = 'ADDRESS_NOT_FOUND';
        error.addressId = addressId;
        throw error;
      }

      result[index] = {
        ...result[index],
        ...fields,
        _id: result[index]._id,
        createdAt: result[index].createdAt || fields.createdAt || new Date(),
      };
      saved.push({ ...result[index], action: 'updated' });
      return;
    }

    const created = {
      ...fields,
      createdAt: fields.createdAt || new Date(),
    };
    result.push(created);
    saved.push({ ...created, action: 'created' });
  });

  return { addresses: result, saved };
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

const isStandaloneBusinessCardField = (fieldname) => {
  const field = String(fieldname || '').trim();
  return /^(?:business_card|businessCard|upload_business_card)$/i.test(field);
};

const resolveStandaloneBusinessCardUploads = (req) =>
  (req.files || [])
    .filter((f) => isStandaloneBusinessCardField(f.fieldname))
    .map((f) => f.filename);

const resolveContactBusinessCardUploads = (req) => {
  const byContactIdx = {};
  for (const file of req.files || []) {
    if (isStandaloneBusinessCardField(file.fieldname)) continue;
    const contactIdx = parseContactBusinessCardField(file.fieldname);
    if (contactIdx === null) continue;
    if (!byContactIdx[contactIdx]) byContactIdx[contactIdx] = [];
    byContactIdx[contactIdx].push(file.filename);
  }
  return byContactIdx;
};

const normalizeContactEntry = (entry) => {
  if (!entry || typeof entry !== 'object') return null;
  const subdocId = getSubdocId(entry);
  return {
    ...(subdocId ? { id: subdocId } : {}),
    position: (entry.position ?? '').toString().trim(),
    department: (entry.department ?? '').toString().trim(),
    name: (entry.name ?? '').toString().trim(),
    phone: (entry.phone ?? '').toString().trim(),
    mobile: (entry.mobile ?? '').toString().trim(),
    email: (entry.email ?? '').toString().trim().toLowerCase(),
    businessCard: normalizeBusinessCardFilenames(entry.businessCard ?? entry.bussinessCard),
    ...(entry.createdAt ? { createdAt: new Date(entry.createdAt) } : {}),
  };
};

const parseContactInput = (body = {}) => {
  const { contactInfo, contact_info, id, _id, contactId } = body;

  if (contactInfo !== undefined || contact_info !== undefined) {
    const parsed = tryParseJson(contactInfo ?? contact_info);
    if (Array.isArray(parsed)) {
      const error = new Error('Send a single contact object, not an array.');
      error.code = 'CONTACT_ARRAY_NOT_ALLOWED';
      throw error;
    }
    if (parsed && typeof parsed === 'object') {
      const one = normalizeContactEntry(parsed);
      return one ? [one] : [];
    }
    return null;
  }

  const hasContactField =
    id !== undefined ||
    _id !== undefined ||
    contactId !== undefined ||
    ['position', 'department', 'name', 'phone', 'mobile', 'email', 'businessCard', 'bussinessCard'].some(
      (field) => body[field] !== undefined
    );

  if (!hasContactField) return null;

  const one = normalizeContactEntry({
    id: id ?? _id ?? contactId,
    position: body.position,
    department: body.department,
    name: body.name,
    phone: body.phone,
    mobile: body.mobile,
    email: body.email,
    businessCard: body.businessCard ?? body.bussinessCard,
    createdAt: body.createdAt,
  });

  return one ? [one] : [];
};

const upsertLeadContacts = (
  existingContacts,
  incomingContacts,
  uploadsByIdx = {},
  standaloneUploads = []
) => {
  const result = toPlainSubdocs(existingContacts);
  const saved = [];

  incomingContacts.forEach((contact, idx) => {
    const idxUploads = uploadsByIdx[idx] || [];
    const extraUploads = incomingContacts.length === 1 ? standaloneUploads : [];
    const newUploads = [...idxUploads, ...extraUploads];
    const fromJson = normalizeBusinessCardFilenames(contact.businessCard ?? contact.bussinessCard);
    const contactId = getSubdocId(contact);
    const { id, _id, ...fields } = contact;

    if (contactId) {
      const index = result.findIndex(
        (r) => String(r._id) === contactId || String(r.id) === contactId
      );
      if (index < 0) {
        const error = new Error(`Contact not found: ${contactId}`);
        error.code = 'CONTACT_NOT_FOUND';
        error.contactId = contactId;
        throw error;
      }

      const existingCards = normalizeBusinessCardFilenames(
        result[index].businessCard ?? result[index].bussinessCard
      );
      const businessCard = [...new Set([...existingCards, ...fromJson, ...newUploads].filter(Boolean))];

      result[index] = {
        ...result[index],
        ...fields,
        businessCard,
        _id: result[index]._id,
        createdAt: result[index].createdAt || fields.createdAt || new Date(),
      };
      saved.push({ ...result[index], action: 'updated' });
      return;
    }

    const businessCard = [...new Set([...fromJson, ...newUploads].filter(Boolean))];
    const created = {
      ...fields,
      businessCard,
      createdAt: fields.createdAt || new Date(),
    };
    result.push(created);
    saved.push({ ...created, action: 'created' });
  });

  return { contactInfo: result, saved };
};

const upsertContactInfo = upsertLeadContacts;

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
  normalizeAddressEntry,
  parseAddressInput,
  formatAddressForResponse,
  upsertAddresses,
  normalizeContactInfo,
  normalizeNotes,
  normalizeActivityLog,
  normalizeBillFilenames,
  normalizeBusinessCardFilenames,
  normalizeContactEntry,
  parseContactInput,
  parseContactBusinessCardField,
  resolveContactBusinessCardUploads,
  resolveStandaloneBusinessCardUploads,
  attachBusinessCardsToContactInfo,
  appendBusinessCardsToContactInfo,
  upsertLeadContacts,
  upsertContactInfo,
  toBusinessCardUrl,
  formatContactForResponse,
  resolveNewBillFilenames,
};
