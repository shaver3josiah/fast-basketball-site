// Run: node --test server/functions/lib/xlsx.test.mjs   (from build/site)
//
// This file opens the bytes. Asserting that buildXlsx returned "a Buffer with length > 0"
// would pass on a file Excel refuses, and the whole point of the writer is a spreadsheet
// somebody sums money in. So: read the central directory, inflate every part, recompute
// every CRC, and read the sheet XML back.
import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { buildXlsx, crc32, colRef, safeText } from './xlsx.mjs';

// --- a minimal ZIP reader -----------------------------------------------------------
// Reads the END OF CENTRAL DIRECTORY, walks the central directory, then follows each
// entry's recorded offset to its local header. That cross-checks the offsets: a reader
// that only walked local headers sequentially would never notice a wrong one.
function readZip(buf) {
  const eocd = buf.length - 22;
  assert.equal(buf.readUInt32LE(eocd), 0x06054b50, 'EOCD signature');
  const count = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  assert.equal(cdOffset + cdSize, eocd, 'central directory ends where the EOCD starts');

  const entries = new Map();
  let p = cdOffset;
  for (let i = 0; i < count; i++) {
    assert.equal(buf.readUInt32LE(p), 0x02014b50, 'central directory signature');
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const compSize = buf.readUInt32LE(p + 20);
    const rawSize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);

    // Follow the offset into the local header and check it agrees with the directory.
    assert.equal(buf.readUInt32LE(localOffset), 0x04034b50, `local header signature for ${name}`);
    assert.equal(buf.readUInt16LE(localOffset + 8), method, `method matches for ${name}`);
    assert.equal(buf.readUInt32LE(localOffset + 14), crc, `local CRC matches directory for ${name}`);
    assert.equal(buf.readUInt32LE(localOffset + 18), compSize, `local comp size for ${name}`);
    assert.equal(buf.readUInt32LE(localOffset + 22), rawSize, `local raw size for ${name}`);
    const localNameLen = buf.readUInt16LE(localOffset + 26);
    const localExtraLen = buf.readUInt16LE(localOffset + 28);
    assert.equal(buf.toString('utf8', localOffset + 30, localOffset + 30 + localNameLen), name);

    const start = localOffset + 30 + localNameLen + localExtraLen;
    const comp = buf.subarray(start, start + compSize);
    assert.equal(method, 8, `${name} is deflated`);
    const data = zlib.inflateRawSync(comp);

    assert.equal(data.length, rawSize, `${name} uncompressed size matches the header`);
    assert.equal(crc32(data), crc, `${name} stored CRC matches a freshly computed one`);

    entries.set(name, data.toString('utf8'));
    p += 46 + nameLen + extraLen + commentLen;
  }
  assert.equal(p, eocd, 'central directory consumed exactly');
  return entries;
}

function unescapeXml(s) {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}

// Every <t> in document order, unescaped. Enough to read the strings back without a parser.
function inlineStrings(sheet) {
  return [...sheet.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(m => unescapeXml(m[1]));
}

function cellOf(sheet, ref) {
  // Lazy on the attributes, or a greedy [^>]* eats the "/" of a self-closing cell, fails
  // the /> branch, and runs the >...</c> branch on into the NEXT row's closing tag.
  const m = sheet.match(new RegExp(`<c r="${ref}"[^>]*?(?:/>|>([\\s\\S]*?)</c>)`));
  return m ? { xml: m[0], inner: m[1] ?? '' } : null;
}

const COLUMNS = [
  { header: 'Name', key: 'name', type: 'string' },
  { header: 'Sessions', key: 'sessions', type: 'number' },
  { header: 'Amount', key: 'amount', type: 'money' },
];

// --- CRC-32 -------------------------------------------------------------------------
// The classic silent corruption. Known vectors, so a broken table is caught here and not
// as "Excel says the file is unreadable".
test('crc32 matches known vectors', () => {
  assert.equal(crc32(Buffer.from('')), 0);
  assert.equal(crc32(Buffer.from('a')), 0xe8b7be43);
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);
  assert.equal(crc32(Buffer.from('The quick brown fox jumps over the lazy dog')), 0x414fa339);
});

// --- package ------------------------------------------------------------------------
test('every required part is present and inflates with a matching CRC', () => {
  const entries = readZip(buildXlsx({ columns: COLUMNS, rows: [{ name: 'A', sessions: 1, amount: 2 }] }));
  for (const part of [
    '[Content_Types].xml',
    '_rels/.rels',
    'xl/workbook.xml',
    'xl/_rels/workbook.xml.rels',
    'xl/styles.xml',
    'xl/worksheets/sheet1.xml',
  ]) {
    assert.ok(entries.has(part), `missing ${part}`);
    assert.ok(entries.get(part).length > 0, `${part} is empty`);
  }
  assert.equal(entries.size, 6);
  // The parts have to reference each other or Excel opens an empty book.
  assert.match(entries.get('_rels/.rels'), /Target="xl\/workbook\.xml"/);
  assert.match(entries.get('xl/_rels/workbook.xml.rels'), /Target="worksheets\/sheet1\.xml"/);
  assert.match(entries.get('xl/_rels/workbook.xml.rels'), /Target="styles\.xml"/);
  assert.match(entries.get('xl/styles.xml'), /numFmtId="164"/);
  assert.match(entries.get('xl/styles.xml'), /&quot;\$&quot;#,##0\.00/);
});

test('the sheet name reaches the workbook', () => {
  const entries = readZip(buildXlsx({ sheetName: 'Leads', columns: COLUMNS, rows: [] }));
  assert.match(entries.get('xl/workbook.xml'), /<sheet name="Leads" sheetId="1" r:id="rId1"\/>/);
});

// --- cells --------------------------------------------------------------------------
test('numbers and money are numeric cells Excel can SUM', () => {
  const rows = [
    { name: 'Ann', sessions: 12, amount: 450 },
    { name: 'Bob', sessions: 24, amount: 183.33 },
  ];
  const sheet = readZip(buildXlsx({ columns: COLUMNS, rows })).get('xl/worksheets/sheet1.xml');

  // No t attribute, a bare <v>: that is the difference between a number and text.
  assert.equal(cellOf(sheet, 'B2').xml, '<c r="B2" s="0"><v>12</v></c>');
  assert.equal(cellOf(sheet, 'B3').xml, '<c r="B3" s="0"><v>24</v></c>');
  assert.equal(cellOf(sheet, 'C2').xml, '<c r="C2" s="1"><v>450</v></c>');
  assert.equal(cellOf(sheet, 'C3').xml, '<c r="C3" s="1"><v>183.33</v></c>');
  assert.doesNotMatch(cellOf(sheet, 'C3').xml, /t="inlineStr"/);

  // Money carries the currency style (cellXfs index 1 -> numFmtId 164), plain numbers do not.
  assert.match(cellOf(sheet, 'C2').xml, /s="1"/);

  // Strings are inline, so there is no sharedStrings table to keep consistent.
  assert.match(cellOf(sheet, 'A2').xml, /t="inlineStr"/);
  assert.match(cellOf(sheet, 'A2').inner, /<is><t xml:space="preserve">Ann<\/t><\/is>/);

  assert.deepEqual(inlineStrings(sheet), ['Name', 'Sessions', 'Amount', 'Ann', 'Bob']);
});

test('a blank or unparseable number is an empty cell, never a zero', () => {
  const rows = [{ name: 'Ann', sessions: null, amount: undefined }, { name: 'Bob', sessions: 'n/a', amount: '$1,200.50' }];
  const sheet = readZip(buildXlsx({ columns: COLUMNS, rows })).get('xl/worksheets/sheet1.xml');
  assert.equal(cellOf(sheet, 'B2').xml, '<c r="B2" s="0"/>');
  assert.equal(cellOf(sheet, 'C2').xml, '<c r="C2" s="1"/>');
  assert.equal(cellOf(sheet, 'B3').xml, '<c r="B3" s="0"/>');
  // A "$1,200.50" that slipped through still reads as money rather than becoming text.
  assert.equal(cellOf(sheet, 'C3').xml, '<c r="C3" s="1"><v>1200.5</v></c>');
});

test('dimension matches the real extent', () => {
  const sheet = readZip(buildXlsx({ columns: COLUMNS, rows: [{}, {}, {}] })).get('xl/worksheets/sheet1.xml');
  assert.match(sheet, /<dimension ref="A1:C4"\/>/);
});

// --- escaping and control characters -------------------------------------------------
test('XML-escapes & < > " and strips characters illegal in XML 1.0', () => {
  const rows = [{ name: `Ben & Jo <b>"x"</b> 'q'`, sessions: 1, amount: 1 }];
  const entries = readZip(buildXlsx({ columns: COLUMNS, rows }));
  const sheet = entries.get('xl/worksheets/sheet1.xml');
  assert.match(sheet, /Ben &amp; Jo &lt;b&gt;&quot;x&quot;&lt;\/b&gt; &apos;q&apos;/);
  // The raw XML must carry no unescaped ampersand or bare angle bracket inside the text.
  assert.doesNotMatch(sheet, /<b>/);
  assert.equal(inlineStrings(sheet)[3], `Ben & Jo <b>"x"</b> 'q'`);

  const nasty = 'a\u0000b\u0008c\u000Bd\u000Ce\u001Ff\u0001g';
  const s2 = readZip(buildXlsx({ columns: COLUMNS, rows: [{ name: nasty }] })).get('xl/worksheets/sheet1.xml');
  assert.equal(inlineStrings(s2)[3], 'abcdefg');
  for (const ch of ['\u0000', '\u0008', '\u000B', '\u000C', '\u001F', '\u0001']) {
    assert.ok(!s2.includes(ch), `illegal character U+${ch.charCodeAt(0).toString(16)} survived`);
  }
  // Tab, newline and return are legal in XML 1.0 and are kept.
  const s3 = readZip(buildXlsx({ columns: COLUMNS, rows: [{ name: 'a\tb\nc' }] })).get('xl/worksheets/sheet1.xml');
  assert.equal(inlineStrings(s3)[3], 'a\tb\nc');
});

// --- formula injection ---------------------------------------------------------------
// Matches admin/admin.js csvCell(): /^[=+\-@\t\r]/ gets an apostrophe prefix.
test('neutralises leading formula characters in string cells', () => {
  const rows = [
    { name: '=HYPERLINK("http://evil","click")', sessions: 1, amount: 1 },
    { name: '-2+3+cmd|\' /C calc\'!A0', sessions: 2, amount: 2 },
  ];
  const sheet = readZip(buildXlsx({ columns: COLUMNS, rows })).get('xl/worksheets/sheet1.xml');
  const texts = inlineStrings(sheet);
  assert.equal(texts[3], `'=HYPERLINK("http://evil","click")`);
  assert.equal(texts[4], `'-2+3+cmd|' /C calc'!A0`);

  // Every character csvCell guards against, and the control-char-then-formula smuggle.
  for (const lead of ['=', '+', '-', '@', '\t', '\r']) {
    const s = readZip(buildXlsx({ columns: COLUMNS, rows: [{ name: lead + 'SUM(A1)' }] })).get('xl/worksheets/sheet1.xml');
    assert.equal(inlineStrings(s)[3], "'" + lead + 'SUM(A1)', `lead ${JSON.stringify(lead)}`);
  }
  assert.equal(safeText('\u0001=SUM(A1)'), "'=SUM(A1)");

  // A negative NUMBER is not touched: it is not a formula, and quoting it would break SUM.
  const s = readZip(buildXlsx({ columns: COLUMNS, rows: [{ amount: -25.5, sessions: -3 }] })).get('xl/worksheets/sheet1.xml');
  assert.equal(cellOf(s, 'C2').xml, '<c r="C2" s="1"><v>-25.5</v></c>');
  assert.equal(cellOf(s, 'B2').xml, '<c r="B2" s="0"><v>-3</v></c>');
});

// --- references ----------------------------------------------------------------------
test('column references pass Z into AA', () => {
  assert.equal(colRef(1), 'A');
  assert.equal(colRef(26), 'Z');
  assert.equal(colRef(27), 'AA');
  assert.equal(colRef(28), 'AB');
  assert.equal(colRef(52), 'AZ');
  assert.equal(colRef(53), 'BA');
  assert.equal(colRef(702), 'ZZ');
  assert.equal(colRef(703), 'AAA');

  // And in a real sheet: 28 columns, so the 27th and 28th must be AA and AB.
  const columns = Array.from({ length: 28 }, (_, i) => ({ header: 'h' + i, key: 'k' + i, type: 'string' }));
  const row = Object.fromEntries(columns.map((c, i) => [c.key, 'v' + i]));
  const sheet = readZip(buildXlsx({ columns, rows: [row] })).get('xl/worksheets/sheet1.xml');
  assert.match(sheet, /<dimension ref="A1:AB2"\/>/);
  assert.equal(inlineStrings(cellOf(sheet, 'AA2').xml)[0], 'v26');
  assert.equal(inlineStrings(cellOf(sheet, 'AB2').xml)[0], 'v27');
  assert.equal(inlineStrings(cellOf(sheet, 'AA1').xml)[0], 'h26');
});

// --- determinism ---------------------------------------------------------------------
// No Date.now() anywhere: identical input must give identical bytes, or a golden check
// on an export can never tell a real change from the clock moving.
test('two calls with the same input are byte-identical', () => {
  const args = { sheetName: 'Leads', columns: COLUMNS, rows: [{ name: 'Ann', sessions: 12, amount: 450 }] };
  assert.deepEqual(buildXlsx(args), buildXlsx(args));
  assert.equal(buildXlsx(args).equals(buildXlsx({ ...args })), true);
  // And the timestamp is a real, readable knob rather than a frozen accident.
  assert.equal(buildXlsx({ ...args, modified: 1767225600 }).equals(buildXlsx(args)), true);
  assert.equal(buildXlsx({ ...args, modified: 1600000000 }).equals(buildXlsx(args)), false);
});

test('rejects a call with no columns', () => {
  assert.throws(() => buildXlsx({ columns: [], rows: [] }), TypeError);
  assert.throws(() => buildXlsx({ columns: COLUMNS, rows: null }), TypeError);
});
