const PDFDocument = require('pdfkit');

const PRIMARY = '#004d4d';
const TEXT_DARK = '#1e293b';
const TEXT_MUTED = '#64748b';
const BORDER = '#e2e8f0';
const HEADER_BG = '#f8fafc';

const PAGE_LEFT = 40;
const PAGE_RIGHT = 572;
const TABLE_WIDTH = PAGE_RIGHT - PAGE_LEFT;
const PAGE_BOTTOM = 740;

const SITE_TABLE_COLUMNS = [
  { key: 'areaName', label: 'Area', width: 58, align: 'left' },
  { key: 'existingFixtureType', label: 'Existing Fixture', width: 108, align: 'left' },
  { key: 'height', label: 'Height', width: 42, align: 'left' },
  { key: 'existingBulbs', label: 'Bulb', width: 32, align: 'left' },
  { key: 'existingQty', label: 'Qty', width: 30, align: 'left' },
  { key: 'proposedFixture', label: 'Proposed', width: 128, align: 'left' },
  { key: 'proposedQty', label: 'Prop Qty', width: 38, align: 'left' },
  { key: 'pricePerUnit', label: 'Unit $', width: 48, align: 'right' },
  { key: 'totalPrice', label: 'Total $', width: 48, align: 'right' },
];

const CELL_PADDING_X = 4;
const CELL_PADDING_Y = 6;
const ROW_GAP = 4;
const NOTE_GAP = 4;
const BODY_FONT_SIZE = 8;
const HEADER_FONT_SIZE = 7.5;

function displayValue(value, fallback = '—') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatHeight(heightFt, heightIn) {
  const ft = displayValue(heightFt, '');
  const inches = displayValue(heightIn, '');
  if (!ft && !inches) return '—';
  if (ft && inches) return `${ft}' ${inches}"`;
  if (ft) return `${ft}'`;
  return `${inches}"`;
}

function formatMoney(value) {
  const raw = String(value ?? '').trim();
  if (!raw || raw === '—') return '—';
  const num = Number(raw.replace(/[^0-9.-]/g, ''));
  if (!Number.isFinite(num) || num === 0) return '—';
  return `$${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function resolveProposedFixture(fixture) {
  if (!fixture || typeof fixture !== 'object') return '—';
  const product = fixture.product && typeof fixture.product === 'object' ? fixture.product : null;
  return displayValue(product?.name || fixture.existingFixtureType);
}

function flattenAreaFixtures(area) {
  if (!area || typeof area !== 'object') return [];
  const fixtures = Array.isArray(area.fixtures) ? area.fixtures : [];
  if (fixtures.length) return fixtures;
  if (
    area.existingFixtureType ||
    area.product_id ||
    area.proposedQty ||
    area.existingQty
  ) {
    return [area];
  }
  return [];
}

function buildAreaRows(areas) {
  const rows = [];
  (areas || []).forEach((area, areaIndex) => {
    const areaName = displayValue(area.areaName, `Area ${areaIndex + 1}`);
    const fixtures = flattenAreaFixtures(area);

    if (!fixtures.length) {
      rows.push({
        areaName,
        existingFixtureType: '—',
        height: '—',
        existingBulbs: '—',
        existingQty: '—',
        proposedFixture: '—',
        proposedQty: '—',
        pricePerUnit: '—',
        totalPrice: '—',
        note: displayValue(area.note),
      });
      return;
    }

    fixtures.forEach((fixture, fixtureIndex) => {
      const qty = Number(String(fixture.proposedQty || '').replace(/[^\d.]/g, ''));
      const unitPrice = Number(
        String(fixture.price || fixture.product?.salesPrice || '').replace(/[^\d.]/g, '')
      );
      const total =
        Number.isFinite(qty) && Number.isFinite(unitPrice) && qty > 0 && unitPrice > 0
          ? formatMoney(qty * unitPrice)
          : '—';

      rows.push({
        areaName: fixtureIndex === 0 ? areaName : `${areaName} (cont.)`,
        existingFixtureType: displayValue(fixture.existingFixtureType),
        height: formatHeight(fixture.heightFt, fixture.heightIn),
        existingBulbs: displayValue(fixture.existingBulbs),
        existingQty: displayValue(fixture.existingQty),
        proposedFixture: resolveProposedFixture(fixture),
        proposedQty: displayValue(fixture.proposedQty),
        pricePerUnit: formatMoney(fixture.price || fixture.product?.salesPrice),
        totalPrice: total,
        note: displayValue(fixture.note || area.note),
      });
    });
  });
  return rows;
}

function measureCellHeight(doc, text, width, fontSize, align = 'left') {
  doc.fontSize(fontSize).font('Helvetica');
  return doc.heightOfString(text, {
    width: width - CELL_PADDING_X * 2,
    align,
  });
}

function drawSectionTitle(doc, title, y) {
  doc.fillColor(PRIMARY).fontSize(12).font('Helvetica-Bold').text(title, PAGE_LEFT, y);
  return y + 18;
}

function drawKeyValueGrid(doc, pairs, startY) {
  const leftX = PAGE_LEFT;
  const rightX = 310;
  const columnWidth = 230;
  let y = startY;

  pairs.forEach((pair, index) => {
    const column = index % 2;
    const row = Math.floor(index / 2);
    const x = column === 0 ? leftX : rightX;
    const currentY = startY + row * 34;

    doc.fillColor(TEXT_MUTED).fontSize(8).font('Helvetica-Bold').text(pair.label.toUpperCase(), x, currentY, {
      width: columnWidth,
    });
    doc.fillColor(TEXT_DARK).fontSize(10).font('Helvetica').text(displayValue(pair.value), x, currentY + 11, {
      width: columnWidth,
    });

    y = currentY + 34;
  });

  return y + 8;
}

function drawSiteTableHeader(doc, y) {
  const headerHeight = 22;
  doc.save();
  doc.rect(PAGE_LEFT, y, TABLE_WIDTH, headerHeight).fill(HEADER_BG);
  doc.restore();

  doc.strokeColor(BORDER).lineWidth(0.75);
  doc.rect(PAGE_LEFT, y, TABLE_WIDTH, headerHeight).stroke();

  let columnX = PAGE_LEFT;
  SITE_TABLE_COLUMNS.forEach((column) => {
    doc
      .strokeColor(BORDER)
      .moveTo(columnX, y)
      .lineTo(columnX, y + headerHeight)
      .stroke();

    doc.fillColor(TEXT_MUTED).fontSize(HEADER_FONT_SIZE).font('Helvetica-Bold');
    doc.text(column.label, columnX + CELL_PADDING_X, y + 7, {
      width: column.width - CELL_PADDING_X * 2,
      align: column.align,
      lineGap: 1,
    });

    columnX += column.width;
  });

  doc
    .strokeColor(BORDER)
    .moveTo(PAGE_RIGHT, y)
    .lineTo(PAGE_RIGHT, y + headerHeight)
    .stroke();

  return y + headerHeight;
}

function measureSiteTableRow(doc, row) {
  let maxCellHeight = 0;

  SITE_TABLE_COLUMNS.forEach((column, index) => {
    const text = displayValue(row[column.key]);
    const height = measureCellHeight(doc, text, SITE_TABLE_COLUMNS[index].width, BODY_FONT_SIZE, column.align);
    maxCellHeight = Math.max(maxCellHeight, height);
  });

  const dataRowHeight = maxCellHeight + CELL_PADDING_Y * 2;
  const hasNote = row.note && row.note !== '—';
  const noteHeight = hasNote
    ? measureCellHeight(doc, `Note: ${row.note}`, TABLE_WIDTH - 12, 7.5, 'left') + NOTE_GAP + 6
    : 0;

  return {
    dataRowHeight,
    totalHeight: dataRowHeight + noteHeight + ROW_GAP,
    hasNote,
    noteHeight,
  };
}

function drawSiteTableRow(doc, row, y) {
  const { dataRowHeight, hasNote, noteHeight } = measureSiteTableRow(doc, row);
  const totalHeight = dataRowHeight + (hasNote ? noteHeight : 0);

  doc.strokeColor(BORDER).lineWidth(0.75);
  doc.rect(PAGE_LEFT, y, TABLE_WIDTH, totalHeight).stroke();

  let columnX = PAGE_LEFT;
  SITE_TABLE_COLUMNS.forEach((column, index) => {
    const text = displayValue(row[column.key]);

    if (index > 0) {
      doc
        .strokeColor(BORDER)
        .moveTo(columnX, y)
        .lineTo(columnX, y + dataRowHeight)
        .stroke();
    }

    doc.fillColor(TEXT_DARK).fontSize(BODY_FONT_SIZE).font('Helvetica');
    doc.text(text, columnX + CELL_PADDING_X, y + CELL_PADDING_Y, {
      width: column.width - CELL_PADDING_X * 2,
      align: column.align,
      lineGap: 1,
    });

    columnX += column.width;
  });

  doc
    .strokeColor(BORDER)
    .moveTo(PAGE_RIGHT, y)
    .lineTo(PAGE_RIGHT, y + dataRowHeight)
    .stroke();

  let nextY = y + dataRowHeight;

  if (hasNote) {
    doc
      .strokeColor(BORDER)
      .moveTo(PAGE_LEFT, nextY)
      .lineTo(PAGE_RIGHT, nextY)
      .stroke();

    doc.fillColor(TEXT_MUTED).fontSize(7.5).font('Helvetica-Oblique');
    doc.text(`Note: ${row.note}`, PAGE_LEFT + CELL_PADDING_X, nextY + NOTE_GAP + 2, {
      width: TABLE_WIDTH - CELL_PADDING_X * 2,
      lineGap: 1,
    });

    nextY += noteHeight;
  }

  return nextY + ROW_GAP;
}

function drawSiteDetailsTable(doc, rows, startY) {
  if (!rows.length) {
    doc.fillColor(TEXT_MUTED).fontSize(10).font('Helvetica').text('No site details on file.', PAGE_LEFT, startY);
    return startY + 20;
  }

  let y = drawSiteTableHeader(doc, startY);

  rows.forEach((row) => {
    const { totalHeight } = measureSiteTableRow(doc, row);

    if (y + totalHeight > PAGE_BOTTOM) {
      doc.addPage();
      y = PAGE_LEFT;
      y = drawSiteTableHeader(doc, y);
    }

    y = drawSiteTableRow(doc, row, y);
  });

  return y;
}

function resolveUserName(user) {
  if (!user || typeof user !== 'object') return '—';
  return displayValue(user.fullName || user.name);
}

function resolvePrimaryAddress(customer) {
  const list = Array.isArray(customer?.addresses) ? customer.addresses : [];
  if (!list.length) return null;
  const sorted = [...list].sort((a, b) => {
    const timeA = new Date(a?.createdAt || 0).getTime();
    const timeB = new Date(b?.createdAt || 0).getTime();
    return timeB - timeA;
  });
  return sorted[0] || null;
}

async function generateSurveyProjectPdfBuffer(payload) {
  const { survey, customer, workflow = 'survey' } = payload;
  const isInstallation = workflow === 'installation';
  const lead = customer?.leadId && typeof customer.leadId === 'object' ? customer.leadId : null;
  const legalName = displayValue(customer?.legalName || customer?.name);
  const company = displayValue(customer?.dba || customer?.company || lead?.dba);
  const salesPerson = displayValue(customer?.user_id?.fullName || customer?.user_id?.name);
  const surveyName = displayValue(survey?.surveyName || customer?.name || lead?.leadName);
  const surveyDate = formatDate(survey?.surveyDate || survey?.createdAt);
  const surveyStatus = displayValue(survey?.status);
  const verifiedDate = formatDate(survey?.confirmDate || customer?.confirmDate);
  const areaRows = buildAreaRows(survey?.areas || []);
  const notes = Array.isArray(survey?.notes) ? survey.notes : [];
  const primaryAddress = resolvePrimaryAddress(customer);
  const installStreet = displayValue(primaryAddress?.street);
  const installCityStateZip = [
    displayValue(primaryAddress?.city, ''),
    displayValue(primaryAddress?.state, ''),
    displayValue(primaryAddress?.zip, ''),
  ]
    .filter((part) => part && part !== '—')
    .join(', ');
  const contractorName = resolveUserName(survey?.assignToContractor);
  const projectManagerName = resolveUserName(survey?.assignedTo);
  const jobId = displayValue(survey?.job_id);
  const installationStatus = displayValue(
    survey?.installationStatus || customer?.installationStatus
  );

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', margin: 40 });
    const chunks = [];

    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const companyName = process.env.COMPANY_NAME || 'RAM GENERAL SUPPLY';

    doc
      .fillColor(PRIMARY)
      .fontSize(18)
      .font('Helvetica-Bold')
      .text(isInstallation ? 'INSTALLATION PROJECT DETAILS' : 'PROJECT DETAILS', PAGE_LEFT, 40);
    doc.fillColor(TEXT_MUTED).fontSize(9).font('Helvetica').text(companyName, PAGE_LEFT, 62);
    doc.text(`Generated: ${formatDate(new Date())}`, PAGE_LEFT, 74);

    let y = 98;
    y = drawSectionTitle(doc, 'Customer Information', y);
    y = drawKeyValueGrid(
      doc,
      [
        { label: 'Legal Name', value: legalName },
        { label: 'Company (DBA)', value: company },
        { label: 'Sales Person', value: salesPerson },
        { label: 'Account Number', value: customer?.accountNumber },
      ],
      y
    );

    y = drawSectionTitle(doc, 'Survey Details', y + 6);
    y = drawKeyValueGrid(
      doc,
      [
        { label: 'Survey Name', value: surveyName },
        { label: 'Survey Date', value: surveyDate },
        { label: 'Status', value: surveyStatus },
        { label: 'Verified Date', value: verifiedDate },
      ],
      y
    );

    if (isInstallation) {
      y = drawSectionTitle(doc, 'Project Information', y + 6);
      y = drawKeyValueGrid(
        doc,
        [
          { label: 'Contractor', value: contractorName },
          { label: 'Project Manager', value: projectManagerName },
          { label: 'Job ID', value: jobId },
          { label: 'Installation Status', value: installationStatus },
        ],
        y
      );

      y = drawSectionTitle(doc, 'Installation Address', y + 6);
      y = drawKeyValueGrid(
        doc,
        [
          { label: 'Street', value: installStreet },
          { label: 'City / State / ZIP', value: installCityStateZip || '—' },
        ],
        y
      );
    }

    y = drawSectionTitle(doc, 'Site Details', y + 6);
    y = drawSiteDetailsTable(doc, areaRows, y);

    y += 10;
    if (y > PAGE_BOTTOM - 40) {
      doc.addPage();
      y = PAGE_LEFT;
    }
    y = drawSectionTitle(doc, 'Notes', y);
    if (!notes.length) {
      doc.fillColor(TEXT_MUTED).fontSize(10).font('Helvetica').text('No notes on file.', PAGE_LEFT, y);
    } else {
      notes.forEach((note) => {
        if (y > PAGE_BOTTOM - 30) {
          doc.addPage();
          y = PAGE_LEFT;
        }
        const title = displayValue(note.title, 'Note');
        const author = displayValue(note.writtenByName, '');
        const createdAt = formatDate(note.createdAt);
        doc.fillColor(TEXT_DARK).fontSize(9).font('Helvetica-Bold').text(title, PAGE_LEFT, y, { width: 520 });
        y += 12;
        doc.fillColor(TEXT_MUTED).fontSize(8).font('Helvetica').text(
          [createdAt !== '—' ? createdAt : '', author].filter(Boolean).join(' · ') || '—',
          PAGE_LEFT,
          y,
          { width: 520 }
        );
        y += 12;
        doc.fillColor(TEXT_DARK).fontSize(9).font('Helvetica').text(displayValue(note.note), PAGE_LEFT, y, {
          width: 520,
        });
        y += doc.heightOfString(displayValue(note.note), { width: 520 }) + 14;
      });
    }

    doc.end();
  });
}

module.exports = {
  generateSurveyProjectPdfBuffer,
};
