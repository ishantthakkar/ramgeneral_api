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

const buildNoteEntry = ({ title, note, userId, createdAt, timestamp } = {}) => {
  const noteText = (note ?? '').toString().trim();
  if (!noteText) return null;

  const at = createdAt ? new Date(createdAt) : timestamp ? new Date(timestamp) : new Date();

  const entry = {
    title: (title ?? '').toString().trim(),
    note: noteText,
    createdAt: at,
    timestamp: at,
  };

  if (userId) {
    entry.user_id = userId;
  }

  return entry;
};

const attachUserIdToNotes = (notes, userId) => {
  if (!userId || !Array.isArray(notes)) return notes || [];
  const now = new Date();
  return notes.map((note) => ({
    ...note,
    user_id: userId,
    createdAt: now,
    timestamp: now,
  }));
};

const formatNoteUserSummary = (userRef) => {
  if (!userRef) return null;

  if (typeof userRef === 'object' && (userRef.fullName !== undefined || userRef.email !== undefined)) {
    return {
      id: userRef._id || userRef.id || null,
      fullName: userRef.fullName || userRef.name || userRef.email || '',
      email: userRef.email || '',
    };
  }

  const id = userRef?._id || userRef?.id || userRef;
  if (!id) return null;

  return {
    id,
    fullName: '',
    email: '',
  };
};

const formatNoteForResponse = (note) => {
  const plain = note?.toObject ? note.toObject() : { ...note };
  const createdBy = formatNoteUserSummary(plain.user_id);

  return {
    _id: plain._id,
    title: plain.title || '',
    note: plain.note || '',
    user_id: createdBy?.id || plain.user_id || null,
    createdByName: createdBy?.fullName || createdBy?.email || '',
    createdByEmail: createdBy?.email || '',
    writtenByName: createdBy?.fullName || createdBy?.email || '',
    createdBy,
    createdAt: plain.createdAt,
    timestamp: plain.timestamp || plain.createdAt || null,
  };
};

const enrichNotesWithAuthors = async (notes) => {
  const list = (Array.isArray(notes) ? notes : []).map((note) =>
    note?.toObject ? note.toObject() : { ...note }
  );

  const userIds = [
    ...new Set(
      list
        .map((note) => {
          const raw = note.user_id;
          const id = raw?._id || raw;
          return id ? String(id) : null;
        })
        .filter(Boolean)
    ),
  ];

  const authorById = {};
  if (userIds.length) {
    const User = require('../models/User');
    const Admin = require('../models/Admin');
    const [users, admins] = await Promise.all([
      User.find({ _id: { $in: userIds } }).select('fullName email').lean(),
      Admin.find({ _id: { $in: userIds } }).select('email').lean(),
    ]);

    users.forEach((user) => {
      authorById[String(user._id)] = {
        id: user._id,
        fullName: user.fullName || '',
        email: user.email || '',
      };
    });

    admins.forEach((admin) => {
      authorById[String(admin._id)] = {
        id: admin._id,
        fullName: admin.email || '',
        email: admin.email || '',
      };
    });
  }

  return list.map((note) => {
    const raw = note.user_id;
    const id = raw?._id || raw;
    const author = id ? authorById[String(id)] : null;

    return formatNoteForResponse({
      ...note,
      user_id: author || raw || null,
    });
  });
};

const enrichNotesForManyRecords = async (records, notesKey = 'notes') => {
  if (!Array.isArray(records) || !records.length) return records || [];

  const cloned = records.map((record) => ({
    ...record,
    [notesKey]: [...(record[notesKey] || [])],
  }));

  const flatNotes = [];
  const placements = [];

  cloned.forEach((record, recordIndex) => {
    (record[notesKey] || []).forEach((note, noteIndex) => {
      flatNotes.push(note);
      placements.push({ recordIndex, noteIndex });
    });
  });

  if (!flatNotes.length) return cloned;

  const enriched = await enrichNotesWithAuthors(flatNotes);

  placements.forEach(({ recordIndex, noteIndex }, flatIndex) => {
    cloned[recordIndex][notesKey][noteIndex] = enriched[flatIndex];
  });

  return cloned;
};

const normalizeNotes = (notes, userId = null) => {
  if (notes === undefined || notes === null) return [];
  const parsed = tryParseJson(notes);
  if (Array.isArray(parsed)) {
    return parsed
      .filter(Boolean)
      .map((n) => {
        if (typeof n === 'string') {
          return buildNoteEntry({ note: n, userId });
        }
        return buildNoteEntry({
          title: n.title,
          note: n.note,
          userId: n.user_id || userId,
          createdAt: n.createdAt,
        });
      })
      .filter(Boolean);
  }
  if (typeof parsed === 'object' && parsed !== null) {
    const one = buildNoteEntry({
      title: parsed.title,
      note: parsed.note,
      userId: parsed.user_id || userId,
      createdAt: parsed.createdAt,
    });
    return one ? [one] : [];
  }
  if (typeof parsed === 'string' && parsed.trim()) {
    const one = buildNoteEntry({ note: parsed, userId });
    return one ? [one] : [];
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
  buildNoteEntry,
  attachUserIdToNotes,
  formatNoteForResponse,
  enrichNotesWithAuthors,
  enrichNotesForManyRecords,
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
