function formatGoogleCalendarDate(date) {
  return date.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
}

function parseTimeString(timeStr, baseDate) {
  const cleaned = String(timeStr || '')
    .replace(/check-in|check-out/gi, '')
    .trim();
  const match = cleaned.match(/^(\d{1,2}):(\d{2})\s*(AM|PM|am|pm)?$/i);
  if (!match) return null;

  let hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  const meridiem = (match[3] || '').toUpperCase();

  if (meridiem === 'PM' && hours < 12) hours += 12;
  if (meridiem === 'AM' && hours === 12) hours = 0;

  const result = new Date(baseDate);
  result.setHours(hours, minutes, 0, 0);
  return result;
}

function parseMeetingDateRange(dateValue, timeSlot) {
  const baseDate = dateValue ? new Date(dateValue) : new Date();
  const safeBase = Number.isNaN(baseDate.getTime()) ? new Date() : baseDate;

  const defaultStart = new Date(safeBase);
  defaultStart.setHours(9, 0, 0, 0);
  const defaultEnd = new Date(defaultStart);
  defaultEnd.setHours(10, 0, 0, 0);

  const slot = String(timeSlot || '').trim();
  if (!slot) {
    return { start: defaultStart, end: defaultEnd };
  }

  const rangeParts = slot.split(/\s*(?:-|–|to)\s*/i).map((part) => part.trim()).filter(Boolean);
  const start = parseTimeString(rangeParts[0], safeBase) || defaultStart;
  const end =
    (rangeParts[1] ? parseTimeString(rangeParts[1], safeBase) : null) ||
    new Date(start.getTime() + 60 * 60 * 1000);

  if (end <= start) {
    end.setTime(start.getTime() + 60 * 60 * 1000);
  }

  return { start, end };
}

function buildGoogleCalendarLink({
  title,
  start,
  end,
  details = '',
  location = '',
  guestEmail = '',
}) {
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: title || 'Meeting',
    dates: `${formatGoogleCalendarDate(start)}/${formatGoogleCalendarDate(end)}`,
    details,
    location,
  });

  if (guestEmail) {
    params.set('add', guestEmail);
  }

  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

function isScheduleMeetingActivity(activityType) {
  return String(activityType || '').trim().toLowerCase() === 'schedule a meeting';
}

module.exports = {
  formatGoogleCalendarDate,
  parseMeetingDateRange,
  buildGoogleCalendarLink,
  isScheduleMeetingActivity,
};
