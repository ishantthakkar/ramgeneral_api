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

const resolveNewBillFilenames = (req, uploadElectricityBill, upload_electricity_bill) => {
  const fromFiles = (req.files && Array.isArray(req.files) ? req.files : []).map(
    (f) => f.filename
  );
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
  resolveNewBillFilenames,
};
