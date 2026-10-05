// What a PDF TABLE's rows contribute as Extracted Fields —
// DocparseEngine's fieldsFromTable.
//
//   node _test/app-harness/table-fields.test.js
//
// Reachable under plain Node for the same reason chop-owner.test.js is: by the
// time fieldsFromTable is called the layout pass has already turned pixels into
// rows of strings, so the fixture is those rows.
//
// The document this was opened for is a scanned Letter of Award — one page, no
// text layer at all, so its rows below are what a real browser OCR run produced
// (there is no way to reach them under Node: no canvas, no OCR model). Its
// terms are a two-column form whose separator is a column of its own:
//
//   Service Period |  | : | 1 May 2026 to 30 Apr 2027 (Both dates inclusive)
//   Contract Sum   |  | : | HK$6,137,434.00
//
// None of it reached the App. Every shape below SHAPE 0 rejected the table, and
// for defensible reasons: the colon column is not labelish, so the pair grid
// declined it, and the values are prose, so the compactness guard declined it
// too. The colon is what makes the row readable without either guard — it has
// SAID it is a separator rather than looking like one.
//
// Amounts and references are substituted; labels, layout and value shapes are
// not. See the root CLAUDE.md on why this directory carries no real document.

const path = require('path');
const fs = require('fs');
const vm = require('vm');

const ENGINE = path.join(__dirname, '..', '..', 'Docparse', 'docparse-engine.js');
vm.runInThisContext(fs.readFileSync(ENGINE, 'utf8'), { filename: 'docparse-engine.js' });
const { fieldsFromTable } = globalThis.DocparseEngine;

let passed = 0;
const failures = [];

function ok(label, cond, detail) {
  if (cond) { passed++; return; }
  failures.push(label + (detail === undefined ? '' : '\n      got: ' + JSON.stringify(detail).slice(0, 600)));
}
function eq(label, actual, expected) { ok(label, actual === expected, { actual, expected }); }
function pairs(rows) { return fieldsFromTable(rows).map(f => f.label + ' => ' + f.value); }
function has(rows, label, value) {
  return fieldsFromTable(rows).some(f => f.label === label && f.value === value);
}

/* ---------- 1. The letter of award, as measured ---------- */

const AWARD = [
  ['Service Period', '', ':', '1 May 2026 to 30 Apr 2027 (Both dates inclusive)'],
  ['Contract Sum', '', ':', 'HK$6,137,434.00'],
  ['', '', '', 'ICT – (Cabling, Networks, Firewall, Server, Storage, Wi-Fi, People Count &'],
  ['', '', '', 'Video Analytics) Maintenance and Support Services for AIRSIDE.'],
  ['Service Content', ':', '', 'For details of the contract terms and conditions, please refer to the'],
  ['', '', '', "document 'Request for Proposal 2025-2028'and 'Hong Kong"],
  ['', '', '', "Telecommunications (HKT) Limited' which proposal."],
  ['', '', '', 'Payment schedule for project will be according to the payment schedule'],
  ['Payment Terms', '', ':', 'in RFP for AIRSIDE ICT Maintenance and Support Services.'],
];

ok('the contract sum is read', has(AWARD, 'Contract Sum', 'HK$6,137,434.00'), pairs(AWARD));
ok('the service period is read', has(AWARD, 'Service Period', '1 May 2026 to 30 Apr 2027 (Both dates inclusive)'),
  pairs(AWARD));
ok('a value far longer than a form field fits is still read -- the colon said so',
  has(AWARD, 'Service Content', 'For details of the contract terms and conditions, please refer to the'),
  pairs(AWARD));
ok('...and so is the last row', has(AWARD, 'Payment Terms', 'in RFP for AIRSIDE ICT Maintenance and Support Services.'),
  pairs(AWARD));
eq('the wrapped continuation rows contribute nothing of their own',
  fieldsFromTable(AWARD).length, 4);

/* ---------- 2. Which rows may be read this way ---------- */

// The colon may be a cell of its own or fused to the front of its value; both
// forms appear on one real quotation's header table, and parseLinePairs already
// reads both on a text line.
{
  const header = [
    ['To', ': PCCW Ltd.', '', 'Date', ': 17-Jun-2026', ''],
    ['Re', ':', '', 'Fax', ': +852 2962 5076', ''],
  ];
  ok('a fused colon is a separator too', has(header, 'Date', '17-Jun-2026'), pairs(header));
  ok('...and the cell to its left is its label', has(header, 'To', 'PCCW Ltd.'), pairs(header));
  // The row holds TWO pairs. Reading only the first makes the second's label
  // the first's value -- measured: "Re => Fax : +852 2962 5076".
  ok('a second pair on the same row is its own pair', has(header, 'Fax', '+852 2962 5076'), pairs(header));
  ok('...and does not become the first label\'s value',
    !fieldsFromTable(header).some(f => f.label === 'Re' && /Fax/.test(f.value)), pairs(header));
}

// The entry ticket. A colon somewhere INSIDE a cell is not a separator, and
// treating it as one swallows a purchase order's line item whole -- measured on
// the corpus, where an earlier version of this rule gained 23 fields of exactly
// that kind before the colon was required to open its cell.
{
  const lineItems = [
    ['Data Centre Mid-range Layer 3 Switch',
      'Switch at least 46 port 10G to 100G, Dual PSU (Model: CE6863-48S6CQ) 10.0 4,577.00 45,770.00'],
    ['Campus Low-end Layer 3 Switch',
      'Switch at least 40 port 100M to 10G, Dual PSU (Model: S5732-H48XUM2CC) 0.5 50.00 25.21'],
    ['Data Centre High-end Layer 3 Switch',
      'Switch at least 26 port 40G to 100G, Dual PSU (Model: CE8850-64CQ-EI) 0.5 10,568.00 5,327.43'],
  ];
  ok('a model number inside a cell is not a separator',
    !fieldsFromTable(lineItems).some(f => /^Model/.test(f.label)), pairs(lineItems));
  ok('...and the line item is not read as a field at all',
    !fieldsFromTable(lineItems).some(f => /Layer 3 Switch/.test(f.label)), pairs(lineItems));
}

// A colon opening the row has nothing to its left to name it.
eq('a row that begins with the separator yields nothing',
  fieldsFromTable([[':', 'value', ''], [':', 'other', '']]).length, 0);

// The label still has to look like one, so a figure cell before a colon does
// not become a label.
eq('a number before the colon is not a label',
  fieldsFromTable([['1,234.00', ':', 'x'], ['5,678.00', ':', 'y']]).length, 0);

/* ---------- 3. The shapes below it still run ---------- */

// A colon-free form grid is still SHAPE 1's, not this one's.
{
  const grid = [
    ['Customer Number', '82332954', 'Customer Name', 'HOSPITAL AUTHORITY'],
    ['Agreement Number', 'H260400464CB', 'Contract Month', '12'],
  ];
  ok('a pair grid with no colons still reads', has(grid, 'Customer Name', 'HOSPITAL AUTHORITY'), pairs(grid));
  ok('...both pairs of it', has(grid, 'Customer Number', '82332954'), pairs(grid));
}

// A figure table read down its first column is still SHAPE 3's.
{
  const figures = [
    ['Contract Revenue', '$715,657.72', '$0.00', '$715,657.72', '100.00%'],
    ['Direct Variable Cost', '$464,301.27', '$0.00', '$464,301.27', '64.88%'],
    ['Gross Profit', '$251,356.45', '$0.00', '$251,356.45', '35.12%'],
  ];
  ok('a figure table still reads down its first column',
    has(figures, 'Contract Revenue', '$715,657.72'), pairs(figures));
  // The percentage is grafted on only when it is the cell straight after the
  // amount ("Gross Profit / GP%"), not when other figures sit between them.
  ok('a percentage immediately after the amount is grafted onto it',
    has([['Gross Profit / GP%', '$251,356.45', '35.12%']], 'Gross Profit / GP%', '$251,356.45 (35.12%)'),
    pairs([['Gross Profit / GP%', '$251,356.45', '35.12%']]));
}

eq('an empty table is not an error', fieldsFromTable([]).length, 0);
eq('a caption row on its own is not a field', fieldsFromTable([['A. Summary by Contract Type']]).length, 0);

/* ---------- report ---------- */

if (failures.length) {
  console.error('\n' + failures.length + ' FAILED of ' + (passed + failures.length) + ':\n');
  failures.forEach(f => console.error('  - ' + f));
  process.exit(1);
}
console.log(passed + ' assertions passed, 0 failed');
