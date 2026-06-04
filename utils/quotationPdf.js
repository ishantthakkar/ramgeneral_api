const PDFDocument = require('pdfkit');
const path = require('path');
const fs = require('fs');

const ORANGE = '#E67E22';
const LIGHT_GRAY = '#E8E8E8';
const TEXT_DARK = '#333333';

function formatMoney(amount) {
  const num = Number(amount) || 0;
  return `$${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(date) {
  const d = date ? new Date(date) : new Date();
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

function normalizeAddressTitle(title) {
  return (title || '').toString().trim().toLowerCase();
}

const GENERIC_ADDRESS_TITLES = new Set([
  'service address',
  'service',
  'billing address',
  'billing',
  'custom',
  '',
]);

function normalizeAddrRecord(raw) {
  if (!raw || typeof raw !== 'object') return null;
  return {
    title: (raw.title ?? raw.label ?? raw.customLabel ?? raw.custom_label ?? '').toString().trim(),
    street: (raw.street ?? raw.addressLine1 ?? raw.address_line1 ?? raw.line1 ?? '')
      .toString()
      .trim(),
    city: (raw.city ?? '').toString().trim(),
    state: (raw.state ?? '').toString().trim(),
    zip: (raw.zip ?? raw.zipCode ?? raw.zip_code ?? raw.postalCode ?? '').toString().trim(),
  };
}

function hasAddressData(addr) {
  if (!addr) return false;
  return Boolean(addr.street || addr.city || addr.state || addr.zip);
}

function getCustomerFallbackAddress(customer) {
  const nested = normalizeAddrRecord(customer.address);
  if (hasAddressData(nested)) return nested;

  return normalizeAddrRecord({
    street: customer.street,
    city: customer.city,
    state: customer.state,
    zip: customer.zip,
  });
}

function getAllCustomerAddresses(customer) {
  const list = (customer.addresses || []).map((a) => normalizeAddrRecord(a)).filter(Boolean);
  const fallback = getCustomerFallbackAddress(customer);

  if (!list.length && hasAddressData(fallback)) {
    return [{ ...fallback, title: fallback.title || 'Service Address' }];
  }

  if (!hasAddressData(fallback)) return list;

  const enriched = list.map((addr) => {
    if (hasAddressData(addr)) return addr;
    return {
      ...addr,
      street: addr.street || fallback.street,
      city: addr.city || fallback.city,
      state: addr.state || fallback.state,
      zip: addr.zip || fallback.zip,
    };
  });

  const hasData = enriched.some((a) => hasAddressData(a));
  if (!hasData) {
    enriched.push({ ...fallback, title: fallback.title || 'Service Address' });
  }

  return enriched;
}

function isBillingAddress(addr) {
  const title = normalizeAddressTitle(addr?.title);
  return title === 'billing address' || title === 'billing' || title.includes('billing');
}

function isServiceAddress(addr) {
  const title = normalizeAddressTitle(addr?.title);
  return (
    title === 'service address' ||
    title === 'service' ||
    (title.includes('service') && !title.includes('billing'))
  );
}

function findServiceAddress(addresses) {
  const list = addresses || [];
  const service = list.find((a) => isServiceAddress(a) && hasAddressData(a));
  if (service) return service;
  return list.find((a) => hasAddressData(a) && !isBillingAddress(a)) || null;
}

function findBillingAddress(addresses) {
  const list = addresses || [];
  return list.find((a) => isBillingAddress(a) && hasAddressData(a)) || null;
}

function getDisplayAddressTitle(addr, customer) {
  const titleKey = normalizeAddressTitle(addr?.title);
  if (titleKey && !GENERIC_ADDRESS_TITLES.has(titleKey)) {
    return addr.title;
  }
  const lead = customer.leadId && typeof customer.leadId === 'object' ? customer.leadId : null;
  return (
    lead?.leadName ||
    lead?.dba ||
    customer.legalName ||
    customer.name ||
    customer.company ||
    ''
  );
}

function addressToLines(customer, addr) {
  const contact = (customer.contactInfo || [])[0] || {};
  const normalized = normalizeAddrRecord(addr) || {};
  const title = getDisplayAddressTitle(normalized, customer);
  const attention = [contact.name, contact.position].filter(Boolean).join(', ');
  const street = normalized.street || '';
  const cityStateZip = [normalized.city, normalized.state, normalized.zip]
    .filter(Boolean)
    .join(', ');

  return { title, attention, street, cityStateZip };
}

function formatAddressLines(customer, type) {
  const addresses = getAllCustomerAddresses(customer);
  const serviceAddr = findServiceAddress(addresses);

  if (type === 'billing') {
    const billingAddr = findBillingAddress(addresses);
    const addr = billingAddr || serviceAddr;
    return addressToLines(customer, addr);
  }

  return addressToLines(customer, serviceAddr);
}

function getQuotationAddresses(customer) {
  return {
    serviceAddress: formatAddressLines(customer, 'service'),
    billingAddress: formatAddressLines(customer, 'billing'),
  };
}

function groupLineItemsByArea(lineItems) {
  const groups = [];
  let current = null;

  for (const row of lineItems || []) {
    const areaKey = (row.area || '').trim() || '—';
    if (!current || current.area !== areaKey) {
      current = { area: areaKey, items: [] };
      groups.push(current);
    }
    current.items.push(row);
  }

  return groups;
}

function generatePdfBuffer(data) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', margin: 40 });
    const chunks = [];

    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const pageWidth = doc.page.width;
    const contentWidth = pageWidth - 80;
    const rightX = pageWidth - 40;

    // Header - company (left)
    doc.fillColor(ORANGE).fontSize(14).font('Helvetica-Bold').text(data.company.name, 40, 40);
    doc.fillColor(TEXT_DARK).fontSize(9).font('Helvetica');
    doc.text(data.company.address, 40, 58);
    doc.text(`Phone: ${data.company.phone}`, 40, 70);
    doc.text(`Email: ${data.company.email}`, 40, 82);

    // Header - title (right)
    doc.fillColor(TEXT_DARK).fontSize(18).font('Helvetica-Bold').text('LIGHTING QUOTATION', 0, 40, {
      width: pageWidth - 40,
      align: 'right',
    });
    doc.fontSize(10).font('Helvetica').text(formatDate(data.generatedDate), 0, 62, {
      width: pageWidth - 40,
      align: 'right',
    });

    let y = 110;

    function drawLabelBox(x, boxWidth, label, lines) {
      doc.fillColor(ORANGE).fontSize(8).font('Helvetica-Bold').text(label, x, y);
      doc.fillColor(TEXT_DARK).fontSize(9).font('Helvetica-Bold').text(lines.title || '', x, y + 12, { width: boxWidth });
      if (lines.attention) {
        doc.font('Helvetica').text(lines.attention, x, y + 24, { width: boxWidth });
      }
      if (lines.street) {
        doc.text(lines.street, x, y + 36, { width: boxWidth });
      }
      if (lines.cityStateZip) {
        doc.text(lines.cityStateZip, x, y + 48, { width: boxWidth });
      }
    }

    const colWidth = (contentWidth - 20) / 2;

    drawLabelBox(40, colWidth, 'SERVICE ADDRESS', data.serviceAddress);
    drawLabelBox(40 + colWidth + 20, colWidth, 'BILLING ADDRESS', data.billingAddress);

    y += 75;

    drawLabelBox(40, colWidth, 'SALES PERSON', {
      title: data.salesPerson.name,
      attention: '',
      street: data.salesPerson.phone ? `Phone: ${data.salesPerson.phone}` : '',
      cityStateZip: '',
    });
    drawLabelBox(40 + colWidth + 20, colWidth, 'CUSTOMER', {
      title: data.customerContact.name,
      attention: '',
      street: data.customerContact.phone ? `Phone: ${data.customerContact.phone}` : '',
      cityStateZip: data.customerContact.email || '',
    });

    y += 70;

    const colArea = 90;
    const colFixture = 180;
    const colQty = 70;
    const colUnit = 90;
    const colTotal = contentWidth - colArea - colFixture - colQty - colUnit;
    const tableX = 40;
    const tableRight = tableX + contentWidth;
    const pad = 8;
    const headerH = 24;
    const rowH = 24;
    const borderColor = '#CCCCCC';
    const colX = {
      area: tableX,
      fixture: tableX + colArea,
      qty: tableX + colArea + colFixture,
      unit: tableX + colArea + colFixture + colQty,
      total: tableX + colArea + colFixture + colQty + colUnit,
      right: tableRight,
    };

    let activeTableTop = y;
    const areaGroups = groupLineItemsByArea(data.lineItems);

    function strokeH(x1, x2, lineY) {
      doc.moveTo(x1, lineY).lineTo(x2, lineY).strokeColor(borderColor).lineWidth(0.5).stroke();
    }

    function strokeV(x, y1, y2) {
      doc.moveTo(x, y1).lineTo(x, y2).strokeColor(borderColor).lineWidth(0.5).stroke();
    }

    function drawHeader() {
      doc.rect(tableX, activeTableTop, contentWidth, headerH).fill(LIGHT_GRAY);
      doc.fillColor(TEXT_DARK).fontSize(8).font('Helvetica-Bold');
      const textY = activeTableTop + 8;
      doc.text('AREA', colX.area + pad, textY, { width: colArea - pad * 2 });
      doc.text('PROPOSED FIXTURE', colX.fixture + pad, textY, { width: colFixture - pad * 2 });
      doc.text('QUANTITY', colX.qty, textY, { width: colQty, align: 'center' });
      doc.text('UNIT PRICE', colX.unit, textY, { width: colUnit - pad, align: 'right' });
      doc.text('TOTAL PRICE', colX.total, textY, { width: colTotal - pad, align: 'right' });

      const headerBottom = activeTableTop + headerH;
      strokeH(tableX, tableRight, headerBottom);
      [colX.fixture, colX.qty, colX.unit, colX.total].forEach((x) => {
        strokeV(x, activeTableTop, headerBottom);
      });
      strokeV(tableX, activeTableTop, headerBottom);
      strokeV(tableRight, activeTableTop, headerBottom);
    }

    function drawRowCells(row, rowTop) {
      const textY = rowTop + 7;
      doc.fillColor(TEXT_DARK).font('Helvetica').fontSize(9);
      doc.text(row.proposedFixture || '', colX.fixture + pad, textY, {
        width: colFixture - pad * 2,
      });
      doc.text(String(row.quantity), colX.qty, textY, { width: colQty, align: 'center' });
      doc.text(formatMoney(row.unitPrice), colX.unit, textY, {
        width: colUnit - pad,
        align: 'right',
      });
      doc.text(formatMoney(row.total), colX.total, textY, {
        width: colTotal - pad,
        align: 'right',
      });
    }

    function drawMergedAreaCell(areaName, groupTop, groupBottom) {
      const cellHeight = groupBottom - groupTop;
      doc.rect(colX.area, groupTop, colArea, cellHeight).strokeColor(borderColor).lineWidth(0.5).stroke();

      doc.fillColor(TEXT_DARK).font('Helvetica').fontSize(9);
      const textHeight = doc.heightOfString(areaName, { width: colArea - pad * 2 });
      const textY = groupTop + Math.max(pad, (cellHeight - textHeight) / 2);
      doc.text(areaName, colX.area + pad, textY, { width: colArea - pad * 2, align: 'left' });
    }

    drawHeader();
    let bodyY = activeTableTop + headerH;
    const pageBottom = doc.page.height - 160;

    for (let g = 0; g < areaGroups.length; g++) {
      const group = areaGroups[g];
      const groupHeight = group.items.length * rowH;

      if (bodyY + groupHeight > pageBottom) {
        doc.addPage();
        activeTableTop = 40;
        drawHeader();
        bodyY = activeTableTop + headerH;
      }

      const groupTop = bodyY;

      for (let i = 0; i < group.items.length; i++) {
        const rowTop = bodyY;
        drawRowCells(group.items[i], rowTop);
        bodyY = rowTop + rowH;

        if (i < group.items.length - 1) {
          strokeH(colX.fixture, tableRight, bodyY);
          strokeV(colX.qty, rowTop, bodyY);
          strokeV(colX.unit, rowTop, bodyY);
          strokeV(colX.total, rowTop, bodyY);
        }
      }

      const groupBottom = bodyY;
      drawMergedAreaCell(group.area, groupTop, groupBottom);
      strokeV(colX.fixture, groupTop, groupBottom);
      strokeV(colX.qty, groupTop, groupBottom);
      strokeV(colX.unit, groupTop, groupBottom);
      strokeV(colX.total, groupTop, groupBottom);
      strokeH(tableX, tableRight, groupBottom);
    }

    const tableBottom = bodyY;
    strokeV(tableX, activeTableTop, tableBottom);
    strokeV(tableRight, activeTableTop, tableBottom);

    y = tableBottom + 20;

    const totalsBoxWidth = 200;
    const totalsX = rightX - totalsBoxWidth;

    doc.rect(totalsX, y, totalsBoxWidth, 56).fill(LIGHT_GRAY);
    doc.fillColor(TEXT_DARK).fontSize(10).font('Helvetica');
    doc.text('Subtotal:', totalsX + 12, y + 12);
    doc.text(formatMoney(data.subtotal), totalsX + 12, y + 12, { width: totalsBoxWidth - 24, align: 'right' });

    if (data.taxAmount > 0) {
      doc.text(`Tax (${Math.round(data.taxRate * 100)}%):`, totalsX + 12, y + 28);
      doc.text(formatMoney(data.taxAmount), totalsX + 12, y + 28, {
        width: totalsBoxWidth - 24,
        align: 'right',
      });
    }

    doc.fillColor(ORANGE).font('Helvetica-Bold').fontSize(11);
    const totalY = data.taxAmount > 0 ? y + 44 : y + 32;
    doc.text('TOTAL PRICE:', totalsX + 12, totalY);
    doc.text(formatMoney(data.grandTotal), totalsX + 12, totalY, {
      width: totalsBoxWidth - 24,
      align: 'right',
    });

    // Signature
    const footerY = doc.page.height - 80;
    doc.fillColor(TEXT_DARK).fontSize(10).font('Helvetica');
    doc.text('Customer Signature', 40, footerY);
    doc.moveTo(40, footerY + 30).lineTo(260, footerY + 30).strokeColor('#999999').stroke();

    // Orange footer bar
    doc.rect(0, doc.page.height - 24, pageWidth, 24).fill(ORANGE);

    doc.end();
  });
}

async function saveQuotationPdf(buffer, customerId) {
  const dir = path.join(__dirname, '../uploads/quotations');
  fs.mkdirSync(dir, { recursive: true });
  const filename = `quotation-${customerId}-${Date.now()}.pdf`;
  const filePath = path.join(dir, filename);
  await fs.promises.writeFile(filePath, buffer);
  const relativePath = `uploads/quotations/${filename}`;
  return { filename, filePath, relativePath };
}

module.exports = {
  formatMoney,
  formatAddressLines,
  getQuotationAddresses,
  generatePdfBuffer,
  saveQuotationPdf,
};
