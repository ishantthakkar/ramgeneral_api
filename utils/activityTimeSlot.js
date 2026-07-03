function parseTimeToMinutes(value) {
  const text = (value || '').toString().trim();
  if (!text) return null;

  const h24 = /^(\d{1,2}):(\d{2})$/.exec(text);
  if (h24) {
    const hh = Number(h24[1]);
    const mm = Number(h24[2]);
    if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
    return hh * 60 + mm;
  }

  const h12 = /^(\d{1,2}):(\d{2})\s*([ap]m)$/i.exec(text);
  if (h12) {
    let hh = Number(h12[1]);
    const mm = Number(h12[2]);
    const ampm = h12[3].toLowerCase();
    if (hh < 1 || hh > 12 || mm < 0 || mm > 59) return null;
    if (ampm === 'pm' && hh !== 12) hh += 12;
    if (ampm === 'am' && hh === 12) hh = 0;
    return hh * 60 + mm;
  }

  return null;
}

function formatMinutesToRange(startMinutes, endMinutes) {
  function toLabel(mins) {
    const hh24 = Math.floor(mins / 60) % 24;
    const mm = mins % 60;
    const ampm = hh24 >= 12 ? 'PM' : 'AM';
    let hh12 = hh24 % 12;
    if (hh12 === 0) hh12 = 12;
    const mmStr = String(mm).padStart(2, '0');
    return `${hh12}:${mmStr} ${ampm}`;
  }

  return `${toLabel(startMinutes)} - ${toLabel(endMinutes)}`;
}

function normalizeActivityTimeSlot({
  time,
  timeSlot,
  fromTime,
  toTime,
  startTime,
  endTime,
  durationMinutes = 30,
}) {
  const rangeText = (timeSlot ?? time ?? '').toString().trim();
  const explicitStart = (fromTime ?? startTime ?? '').toString().trim();
  const explicitEnd = (toTime ?? endTime ?? '').toString().trim();

  if (explicitStart && explicitEnd) {
    return `${explicitStart} - ${explicitEnd}`;
  }

  if (rangeText && /\s*(?:-|–|to)\s*/i.test(rangeText)) {
    const parts = rangeText
      .split(/\s*(?:-|–|to)\s*/i)
      .map((part) => part.trim())
      .filter(Boolean);

    if (parts[0] && parts[1]) {
      return `${parts[0]} - ${parts[1]}`;
    }
  }

  const singleStart = rangeText || explicitStart;
  if (!singleStart) return '';

  const startMinutes = parseTimeToMinutes(singleStart);
  if (startMinutes === null) return singleStart;

  return formatMinutesToRange(startMinutes, startMinutes + durationMinutes);
}

function parseActivityDateOnly(value) {
  if (value === undefined || value === null || String(value).trim() === '') {
    return new Date();
  }

  const text = value.toString().trim();
  const isoDateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (isoDateMatch) {
    const y = Number(isoDateMatch[1]);
    const m = Number(isoDateMatch[2]);
    const d = Number(isoDateMatch[3]);
    const dt = new Date(y, m - 1, d);
    if (
      Number.isNaN(dt.getTime()) ||
      dt.getFullYear() !== y ||
      dt.getMonth() !== m - 1 ||
      dt.getDate() !== d
    ) {
      return new Date();
    }
    return dt;
  }

  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

module.exports = {
  parseTimeToMinutes,
  formatMinutesToRange,
  normalizeActivityTimeSlot,
  parseActivityDateOnly,
};
