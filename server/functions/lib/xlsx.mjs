// A .xlsx writer with no dependencies. This is loaded inside the Cloud Function, so the
// only import is node:zlib; nothing here reaches for firebase-admin, a bundler or the network.
//
// Why write one at all: the CSV export in admin/admin.js is fine for a spreadsheet nobody
// sums, but a money export wants real numeric cells so Excel can SUM a column and a currency
// format so $183.33 is not read as text. A library for that is 4MB of ZIP and XML we would
// only use the corner of.
//
// ponytail: one sheet, no shared strings, no column widths, no freeze pane. Add when a
// consumer actually asks; every part below is required by the format, not by taste.
import zlib from 'node:zlib';

// A fixed clock. Two calls with the same rows must produce the same bytes, so a golden test
// (or a byte-for-byte deploy check) can compare them. 2026-01-01T00:00:00Z.
const FIXED_MODIFIED = 1767225600;

// ---------------------------------------------------------------------------
// CRC-32. A wrong CRC is the classic silent corruption: every byte of the file is
// right, the ZIP reader recomputes the checksum, and Excel refuses to open it with
// no useful message. Tested directly in xlsx.test.mjs against known vectors.
// ---------------------------------------------------------------------------
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

export function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

// ---------------------------------------------------------------------------
// Text safety
// ---------------------------------------------------------------------------

// XML 1.0 forbids these outright: there is no escape for them, a document carrying one
// is not well-formed, and a parent typed a name into a form so one can arrive.
// 0x09 (tab), 0x0A (newline) and 0x0D (return) are legal and are kept.
const ILLEGAL_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g;

function esc(s) {
  return s
    .replace(ILLEGAL_XML, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// Spreadsheet formula injection, neutralised exactly the way admin/admin.js csvCell() does it:
//   if(/^[=+\-@\t\r]/.test(s)) s = "'" + s;
// The reasoning is the same and belongs here too. A value a stranger typed into the public
// enrollment form ends up in a cell the owner opens in Excel. If it starts with one of those
// characters Excel treats the cell as a formula, so `=HYPERLINK(...)` or a DDE payload runs
// on open. The apostrophe forces it to text and Excel does not display the apostrophe.
// Control characters are stripped FIRST, so "\x01=SUM(A1)" cannot smuggle a formula past
// the prefix test by hiding behind a byte that the XML layer would have removed later.
export function safeText(value) {
  let s = value == null ? '' : String(value);
  s = s.replace(ILLEGAL_XML, '');
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return s;
}

// ---------------------------------------------------------------------------
// Cell references: 1 -> A, 26 -> Z, 27 -> AA. An export with more than 26 questions
// is not hypothetical; the registration form already has 26 fields plus the lead columns.
// ---------------------------------------------------------------------------
export function colRef(n) {
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = (n - 1 - r) / 26;
  }
  return s;
}

// ---------------------------------------------------------------------------
// Sheet XML
// ---------------------------------------------------------------------------
const STYLE_GENERAL = 0;
const STYLE_MONEY = 1;
const STYLE_HEADER = 2;

function textCell(ref, value, style) {
  // xml:space="preserve" unconditionally: a neutralised tab-leading value keeps its
  // whitespace, and a trimmed cell is a silent edit of what the parent typed.
  return `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${esc(safeText(value))}</t></is></c>`;
}

function numCell(ref, value, style) {
  // Not a number -> an empty cell, never a zero. A blank amount and $0.00 mean different
  // things on a money sheet and SUM must not invent the difference. Note Number('') is 0
  // and Number(null) is 0, so the empty check has to come BEFORE the coercion.
  let n = value;
  if (typeof n !== 'number') {
    const s = String(n ?? '').replace(/[$,\s]/g, '');
    n = s === '' ? NaN : Number(s);
  }
  if (!Number.isFinite(n)) return `<c r="${ref}" s="${style}"/>`;
  // No t attribute and a bare <v>: that is what makes it a number Excel will SUM.
  return `<c r="${ref}" s="${style}"><v>${n}</v></c>`;
}

function sheetXml(sheetName, columns, rows) {
  const lastCol = colRef(Math.max(columns.length, 1));
  const lastRow = rows.length + 1;
  const out = [];

  out.push('<row r="1">');
  columns.forEach((c, i) => out.push(textCell(colRef(i + 1) + '1', c.header, STYLE_HEADER)));
  out.push('</row>');

  rows.forEach((row, ri) => {
    const r = ri + 2;
    out.push(`<row r="${r}">`);
    columns.forEach((c, i) => {
      const ref = colRef(i + 1) + r;
      const v = row[c.key];
      if (c.type === 'money') out.push(numCell(ref, v, STYLE_MONEY));
      else if (c.type === 'number') out.push(numCell(ref, v, STYLE_GENERAL));
      else out.push(textCell(ref, v, STYLE_GENERAL));
    });
    out.push('</row>');
  });

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:${lastCol}${lastRow}"/><sheetData>${out.join('')}</sheetData></worksheet>`;
}

// Excel refuses these characters in a sheet name and caps it at 31, so a caller passing a
// lead's name or a date range does not get an unopenable file.
function safeSheetName(name) {
  const s = String(name ?? '').replace(ILLEGAL_XML, '').replace(/[\\/?*[\]:]/g, ' ').slice(0, 31).trim();
  return s || 'Sheet1';
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;

const WORKBOOK_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;

// numFmtId 164 is the first id available to a custom format; 0-163 are built in.
// Two fills and the empty border are not decoration: Excel treats a styles part missing
// them as corrupt.
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="&quot;$&quot;#,##0.00"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

// ---------------------------------------------------------------------------
// ZIP, by hand. Local file header + central directory + EOCD, deflate (method 8),
// no data descriptors and no ZIP64 (a leads export is kilobytes, not gigabytes).
// ---------------------------------------------------------------------------
function dosDateTime(epochSeconds) {
  const d = new Date(epochSeconds * 1000); // UTC below, so no machine-timezone drift.
  const time = (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | (d.getUTCSeconds() >> 1);
  const date = ((d.getUTCFullYear() - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate();
  return { time: time & 0xffff, date: date & 0xffff };
}

function zip(files, modified) {
  const { time, date } = dosDateTime(modified);
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const [name, text] of files) {
    const nameBuf = Buffer.from(name, 'utf8');
    const data = Buffer.from(text, 'utf8');
    const comp = zlib.deflateRawSync(data, { level: 9 });
    const crc = crc32(data);

    const local = Buffer.alloc(30 + nameBuf.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(8, 8); // method: deflate
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comp.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28); // extra field length
    nameBuf.copy(local, 30);

    const central = Buffer.alloc(46 + nameBuf.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(comp.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30); // extra
    central.writeUInt16LE(0, 32); // comment
    central.writeUInt16LE(0, 34); // disk number start
    central.writeUInt16LE(0, 36); // internal attrs
    central.writeUInt32LE(0, 38); // external attrs
    central.writeUInt32LE(offset, 42);
    nameBuf.copy(central, 46);

    locals.push(local, comp);
    centrals.push(central);
    offset += local.length + comp.length;
  }

  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4); // this disk
  eocd.writeUInt16LE(0, 6); // disk with central directory
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16); // central directory offset
  eocd.writeUInt16LE(0, 20); // comment length

  return Buffer.concat([...locals, cd, eocd]);
}

/**
 * Build a single-sheet .xlsx.
 *
 * @param {object} opts
 * @param {string} [opts.sheetName]
 * @param {Array<{header: string, key: string, type?: 'string'|'number'|'money'}>} opts.columns
 * @param {Array<object>} opts.rows  plain objects keyed by column.key
 * @param {number} [opts.modified]   epoch SECONDS for the ZIP entries; fixed by default so
 *                                   identical input yields identical bytes
 * @returns {Buffer} the .xlsx file
 *
 * A 'money' value is a NUMBER OF DOLLARS. The caller converts: the store keeps cents
 * (amountCents), and dividing here would hide the conversion from whoever reads the caller.
 */
export function buildXlsx({ sheetName = 'Sheet1', columns, rows, modified = FIXED_MODIFIED } = {}) {
  if (!Array.isArray(columns) || !columns.length) throw new TypeError('buildXlsx: columns required');
  if (!Array.isArray(rows)) throw new TypeError('buildXlsx: rows must be an array');

  const name = safeSheetName(sheetName);
  return zip([
    ['[Content_Types].xml', CONTENT_TYPES],
    ['_rels/.rels', ROOT_RELS],
    ['xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${esc(name)}" sheetId="1" r:id="rId1"/></sheets></workbook>`],
    ['xl/_rels/workbook.xml.rels', WORKBOOK_RELS],
    ['xl/styles.xml', STYLES],
    ['xl/worksheets/sheet1.xml', sheetXml(name, columns, rows)],
  ], modified);
}
