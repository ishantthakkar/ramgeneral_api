const nodemailer = require('nodemailer');
const User = require('../models/User');
const { isSalesPersonRole } = require('../constants/userRoles');
const {
  buildGoogleCalendarLink,
  isScheduleMeetingActivity,
  parseMeetingDateRange,
} = require('./googleCalendar');
const {
  buildCalendarInviteIcs,
  buildCalendarUid,
  formatCalendarWhenLabel,
} = require('./calendarInvite');

const COMPANY_NAME = process.env.COMPANY_NAME || 'RAM General Supply';
const MEETING_TIMEZONE = process.env.MEETING_TIMEZONE || 'Asia/Kolkata';

function resolveCustomerEmail(customer) {
  const direct = (customer?.email || '').toString().trim();
  if (direct) return direct;

  const contact = (customer?.contactInfo || []).find((entry) =>
    (entry?.email || '').toString().trim()
  );
  return (contact?.email || '').toString().trim();
}

function resolveCustomerName(customer) {
  return (
    (customer?.name || customer?.dba || customer?.legalName || 'Customer').toString().trim()
  );
}

async function resolveSalesPersonUser(customer, fallbackUserId) {
  const assignedSalesPersonId = customer?.user_id?._id || customer?.user_id;
  const candidateIds = [assignedSalesPersonId, fallbackUserId].filter(Boolean);

  for (const userId of candidateIds) {
    const user =
      customer?.user_id &&
      typeof customer.user_id === 'object' &&
      String(customer.user_id._id || customer.user_id) === String(userId)
        ? customer.user_id
        : await User.findById(userId).select('fullName email userRole mobileNumber').lean();

    if (!user?.email) continue;

    if (assignedSalesPersonId && String(userId) === String(assignedSalesPersonId)) {
      return user;
    }

    if (isSalesPersonRole(user.userRole)) {
      return user;
    }
  }

  return null;
}

function getMailTransport() {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    return null;
  }

  return nodemailer.createTransport({
    host,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE || 'false').toLowerCase() === 'true',
    auth: { user, pass },
  });
}

function buildMeetingGuidelines({ meetLink, location }) {
  if (meetLink) {
    return [
      'Kindly join the meeting using a laptop or desktop system (preferred).',
      'Ensure you have a stable internet connection to avoid disruptions.',
      'Please keep your camera ON for the entire duration of the meeting.',
      'Join a few minutes early to test audio and video.',
    ];
  }

  if (location) {
    return [
      'Please be available at the scheduled location on time.',
      'Carry any documents or details discussed earlier, if applicable.',
      'If you need to reschedule, reply to this email in advance.',
    ];
  }

  return [
    'Please confirm your availability for the scheduled meeting.',
    'If you need to reschedule, reply to this email in advance.',
  ];
}

function buildMeetingInvitePayload({ customer, salesPerson, activity }) {
  const customerName = resolveCustomerName(customer);
  const salesPersonName = (salesPerson?.fullName || 'Sales Team').toString().trim();
  const salesPersonEmail = (salesPerson?.email || '').toString().trim();
  const salesPersonMobile = (salesPerson?.mobileNumber || '').toString().trim();
  const customerEmail = resolveCustomerEmail(customer);
  const { start, end } = parseMeetingDateRange(activity?.date, activity?.timeSlot);
  const location = [activity?.location, activity?.address].filter(Boolean).join(' - ').trim();
  const notes = [activity?.notes, activity?.outcome].filter(Boolean).join('\n').trim();
  const meetLink = (activity?.meetLink || activity?.googleMeetLink || '').toString().trim();
  const meetingType = (activity?.meetingType || 'Business Meeting').toString().trim();
  const meetingTitle =
    (activity?.meetingTitle || `${customerName} : ${meetingType}`).toString().trim();
  const whenLabel = formatCalendarWhenLabel(start, end, MEETING_TIMEZONE);
  const guidelines = buildMeetingGuidelines({ meetLink, location });
  const uid = buildCalendarUid(activity?._id || activity?.id);

  const descriptionLines = [
    `Hello ${customerName},`,
    '',
    `${salesPersonName} from ${COMPANY_NAME} has scheduled a meeting with you.`,
    '',
    'Please note the following guidelines:',
    ...guidelines.map((line) => `- ${line}`),
    notes ? `\nAdditional Notes:\n${notes}` : '',
    meetLink ? `\nJoin Link:\n${meetLink}` : '',
    salesPersonMobile ? `\nContact: ${salesPersonName} (${salesPersonMobile})` : '',
    '',
    'Thank you,',
    `${salesPersonName}`,
    COMPANY_NAME,
  ].filter(Boolean);

  const googleCalendarLink = buildGoogleCalendarLink({
    title: meetingTitle,
    start,
    end,
    details: descriptionLines.join('\n'),
    location: meetLink || location,
    guestEmail: customerEmail,
  });

  const icsContent = buildCalendarInviteIcs({
    uid,
    start,
    end,
    summary: meetingTitle,
    description: descriptionLines.join('\n'),
    location: meetLink || location,
    organizerName: salesPersonName,
    organizerEmail: salesPersonEmail,
    attendeeName: customerName,
    attendeeEmail: customerEmail,
  });

  const subject = `Invitation: ${meetingTitle} @ ${whenLabel} (${customerEmail})`;

  return {
    uid,
    customerEmail,
    customerName,
    salesPersonName,
    salesPersonEmail,
    salesPersonMobile,
    meetingTitle,
    meetingType,
    whenLabel,
    location,
    meetLink,
    notes,
    guidelines,
    descriptionLines,
    googleCalendarLink,
    icsContent,
    subject,
    start,
    end,
  };
}

function buildMeetingInviteHtml(payload) {
  const guidelinesHtml = payload.guidelines
    .map((line) => `<li style="margin-bottom:8px;">${line}</li>`)
    .join('');

  return `
    <div style="font-family:Arial,Helvetica,sans-serif;color:#202124;max-width:720px;line-height:1.5;">
      <p style="font-size:14px;margin:0 0 16px;">Hi ${payload.customerName},</p>

      <p style="font-size:14px;margin:0 0 16px;">
        ${payload.salesPersonName} from <strong>${COMPANY_NAME}</strong> has scheduled a meeting with you.
        Please review the details below.
      </p>

      <p style="font-size:14px;margin:0 0 8px;">As part of this meeting, please take note of the following guidelines:</p>
      <ul style="font-size:14px;padding-left:20px;margin:0 0 20px;">${guidelinesHtml}</ul>

      ${payload.notes ? `<p style="font-size:14px;margin:0 0 16px;"><strong>Notes:</strong> ${payload.notes}</p>` : ''}

      <div style="border-top:1px solid #dadce0;padding-top:16px;margin-top:20px;">
        <p style="font-size:14px;margin:0 0 8px;"><strong>When</strong><br>${payload.whenLabel}</p>
        <p style="font-size:14px;margin:0 0 8px;"><strong>Organizer</strong><br>${payload.salesPersonName} (${payload.salesPersonEmail})</p>
        ${payload.location ? `<p style="font-size:14px;margin:0 0 8px;"><strong>Location</strong><br>${payload.location}</p>` : ''}
        <p style="font-size:14px;margin:0 0 8px;"><strong>Guests</strong><br>${payload.customerEmail}</p>
      </div>

      ${
        payload.meetLink
          ? `<div style="margin:24px 0;">
              <a href="${payload.meetLink}" target="_blank" rel="noopener noreferrer"
                style="display:inline-block;background:#1a73e8;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:24px;font-size:14px;font-weight:600;">
                Join with Google Meet
              </a>
              <p style="font-size:13px;color:#5f6368;margin:12px 0 0;">Meeting link: <a href="${payload.meetLink}">${payload.meetLink}</a></p>
            </div>`
          : `<div style="margin:24px 0;">
              <a href="${payload.googleCalendarLink}" target="_blank" rel="noopener noreferrer"
                style="display:inline-block;background:#1a73e8;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:24px;font-size:14px;font-weight:600;">
                Add to Google Calendar
              </a>
            </div>`
      }

      <p style="font-size:14px;margin:24px 0 0;">
        Thank you,<br>
        ${payload.salesPersonName}<br>
        ${COMPANY_NAME}
        ${payload.salesPersonMobile ? `<br>(M): ${payload.salesPersonMobile}` : ''}
      </p>
    </div>
  `;
}

function buildMeetingInviteText(payload) {
  return [
    `Hi ${payload.customerName},`,
    '',
    `${payload.salesPersonName} from ${COMPANY_NAME} has scheduled a meeting with you.`,
    '',
    'Guidelines:',
    ...payload.guidelines.map((line) => `- ${line}`),
    '',
    payload.notes ? `Notes: ${payload.notes}` : '',
    '',
    `When: ${payload.whenLabel}`,
    `Organizer: ${payload.salesPersonName} (${payload.salesPersonEmail})`,
    payload.location ? `Location: ${payload.location}` : '',
    payload.meetLink ? `Join Link: ${payload.meetLink}` : '',
    `Guests: ${payload.customerEmail}`,
    '',
    payload.meetLink
      ? `Join with Google Meet: ${payload.meetLink}`
      : `Add to Google Calendar: ${payload.googleCalendarLink}`,
    '',
    'Thank you,',
    payload.salesPersonName,
    COMPANY_NAME,
    payload.salesPersonMobile ? `(M): ${payload.salesPersonMobile}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

async function sendMeetingInviteEmail(payload) {
  const transport = getMailTransport();
  if (!transport) {
    return {
      emailSent: false,
      reason: 'SMTP is not configured. Set SMTP_HOST, SMTP_USER, and SMTP_PASS.',
    };
  }

  if (!payload.customerEmail) {
    return {
      emailSent: false,
      reason: 'Customer email not found.',
    };
  }

  if (!payload.salesPersonEmail) {
    return {
      emailSent: false,
      reason: 'Sales person email not found.',
    };
  }

  const smtpFromEmail = (process.env.SMTP_USER || payload.salesPersonEmail).toString().trim();
  const fromAddress = `"${payload.salesPersonName}" <${smtpFromEmail}>`;
  const html = buildMeetingInviteHtml(payload);
  const text = buildMeetingInviteText(payload);

  await transport.sendMail({
    from: fromAddress,
    replyTo: payload.salesPersonEmail,
    to: payload.customerEmail,
    subject: payload.subject,
    text,
    html,
    icalEvent: {
      filename: 'meeting-invite.ics',
      method: 'REQUEST',
      content: payload.icsContent,
    },
  });

  return {
    emailSent: true,
    sentTo: payload.customerEmail,
    sentFrom: payload.salesPersonEmail,
    subject: payload.subject,
  };
}

async function sendScheduleMeetingInviteIfNeeded({ customer, salesPerson, activity, fallbackUserId }) {
  if (!isScheduleMeetingActivity(activity?.activityType)) {
    return null;
  }

  const resolvedSalesPerson =
    salesPerson || (await resolveSalesPersonUser(customer, fallbackUserId));

  const payload = buildMeetingInvitePayload({
    customer,
    salesPerson: resolvedSalesPerson,
    activity,
  });
  const emailResult = await sendMeetingInviteEmail(payload);

  return {
    googleCalendarLink: payload.googleCalendarLink,
    meetingTitle: payload.meetingTitle,
    when: payload.whenLabel,
    salesPerson: resolvedSalesPerson
      ? {
          id: resolvedSalesPerson._id,
          fullName: resolvedSalesPerson.fullName || '',
          email: resolvedSalesPerson.email || '',
          mobileNumber: resolvedSalesPerson.mobileNumber || '',
        }
      : null,
    ...emailResult,
  };
}

module.exports = {
  resolveCustomerEmail,
  resolveSalesPersonUser,
  buildMeetingInvitePayload,
  sendMeetingInviteEmail,
  sendScheduleMeetingInviteIfNeeded,
  isScheduleMeetingActivity,
};
