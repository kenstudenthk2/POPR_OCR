// What a spreadsheet's cells contribute as Extracted Fields —
// DocparseEngine's extractFieldsFromSheet.
//
//   node _test/app-harness/sheet-fields.test.js
//
// The engine half needs no browser and no XLSX build: extractFieldsFromSheet's
// only call into XLSX is `sheet_to_json(sheet, {header: 1})`, which returns a
// plain array-of-arrays grid. Stubbing that one call lets the fixture BE the
// grid, which is the thing worth reading in a test about column layout.
//
// The fixture is the measured grid of a real Cisco "Price Estimate" workbook
// that a user set as the Quotation slot and got a completely empty column from.
// Its layout is the point: the supplier block sits in column A, the customer's
// in column K, and the estimate's own reference is in column J:L —
//
//   r 5   A "<rep name>"                     K "UNIVERSITY OF HONG KONG, THE"
//   r15   A "Date: 29-Mar-2026"     J "Estimate ID:"     L "<reference>"
//
// Personal names, the reference and the amounts are substituted (the layout,
// spellings and cell shapes are not) — this directory is version-controlled and
// the source document is a real commercial quotation. See the root CLAUDE.md.

const path = require('path');
const fs = require('fs');
const vm = require('vm');

const ENGINE = path.join(__dirname, '..', '..', 'Docparse', 'docparse-engine.js');
vm.runInThisContext(fs.readFileSync(ENGINE, 'utf8'), { filename: 'docparse-engine.js' });
const { extractFieldsFromSheet } = globalThis.DocparseEngine;

let passed = 0;
const failures = [];

function ok(label, cond, detail) {
  if (cond) { passed++; return; }
  failures.push(label + (detail === undefined ? '' : '\n      got: ' + JSON.stringify(detail).slice(0, 600)));
}
function eq(label, actual, expected) {
  ok(label, actual === expected, { actual, expected });
}

// `grid` is a sparse {row: {col: value}} literal so the column indexes stay
// visible; `fieldsOf` densifies it and runs the engine against the result.
function fieldsOf(grid) {
  const maxRow = Math.max(...Object.keys(grid).map(Number));
  const rows = [];
  for (let r = 0; r <= maxRow; r++) {
    const cells = grid[r] || {};
    const maxCol = Object.keys(cells).length ? Math.max(...Object.keys(cells).map(Number)) : -1;
    const row = [];
    for (let c = 0; c <= maxCol; c++) row.push(cells[c] === undefined ? '' : cells[c]);
    rows.push(row);
  }
  const prev = globalThis.XLSX;
  globalThis.XLSX = { utils: { sheet_to_json: () => rows } };
  try { return extractFieldsFromSheet({}) || []; }
  finally { globalThis.XLSX = prev; }
}
function pairs(grid) {
  return fieldsOf(grid).map(f => f.label + ' => ' + f.value);
}
function has(list, label, value) {
  return list.some(f => f.label === label && f.value === value);
}

/* ---------- 1. The Cisco price estimate, as measured ---------- */

const ESTIMATE = {
  0:  { 0: 'Price Estimate' },
  5:  { 0: 'Ada Chan', 10: 'UNIVERSITY OF HONG KONG, THE' },
  6:  { 0: 'Cisco Systems, Inc.', 10: 'FT 108 COMPUTER CTR,RUN RUN SHAW BLDG' },
  7:  { 0: '31F,Great Eagle Centre,23 Harbour Road, Wan Chai', 10: 'HONG KONG,' },
  8:  { 0: 'HONG KONG, HK-0', 10: 'HONG KONG' },
  9:  { 0: 'HONG KONG' },
  10: { 0: 'Ph no:+852 0000 0000' },
  13: { 0: 'Price Estimate for planning and information purposes only and is not a binding offer from Cisco.' },
  15: { 0: 'Date: 29-Mar-2026', 9: 'Estimate ID:', 11: 'JD900000001ZZ' },
  16: { 9: 'Deal ID:', 11: 'NA' },
  17: { 9: 'Price List:', 11: 'Global Asia-Pac Price List in US dollars (USD)' },
  19: { 9: 'All prices are shown in USD' },
  20: { 0: 'Line Number', 1: 'Part Number', 2: 'Smart Account Mandatory', 3: 'Description',
        4: 'Service Duration (Months)', 5: 'Estimated Lead Time (Days)', 6: 'Unit List Price',
        7: 'Pricing Term', 8: 'Qty', 9: 'Unit Net Price', 10: 'Disc(%)', 11: 'Extended Net Price' },
  21: { 0: '1.0', 1: 'DUO-EDU-SUB', 2: '-', 3: 'Cisco Duo subscription for Educational institutions',
        4: '---', 5: '7', 6: '0.00', 8: '1', 9: '0.00', 10: '20.00', 11: '0.00' },
  22: { 1: 'Initial Term - 12.00 Months | Auto Renewal Term - 0 Months | Billing Model - Prepaid Term'
          + ' | Requested Start Date - 26-May-2026 | Requested End Date - 25-May-2027' },
  23: { 0: '1.1', 1: 'DUO-EDU-PRE-F', 2: '-', 3: 'Duo Premier for edu Faculty users (formerly Beyond-F)',
        4: '---', 5: '3', 6: '108.00', 7: '12', 8: '50', 9: '86.40', 10: '20.00', 11: '1,234.00' },
  24: { 0: '1.2', 1: 'SVS-DUO-SUP-B', 2: '-', 3: 'Cisco Support Standard for Duo',
        4: '---', 5: '3', 6: '0.00', 7: '1', 8: '1', 9: '0.00', 10: '20.00', 11: '0.00' },
  27: { 0: 'Valid through: 21-Nov-2026', 9: 'Product Total', 11: '0.00' },
  28: { 0: 'FOB Point: None', 9: 'Service Total :', 11: '0.00' },
  29: { 9: 'Subscription Total', 11: '1234.00' },
  30: { 9: 'Total Price:', 11: '1234.00' },
  31: { 0: 'Notes' },
  32: { 9: 'Signed:' },
  33: { 11: 'Ada Chan' },
};

const estimate = fieldsOf(ESTIMATE);

// The bug this file was opened for. Row 15 holds THREE cells: a date in column
// A, the label in column J and its value in column L. Collapsing the empty
// columns away paired A with J -- so the reference was read as a *value*, its
// own value was dropped, and the Quotation column had no quotation number.
ok('the estimate\'s own reference is read from the far side of the sheet',
  has(estimate, 'Estimate ID', 'JD900000001ZZ'), pairs(ESTIMATE));
ok('...and the date in column A is read as the pair it already is',
  has(estimate, 'Date', '29-Mar-2026'), pairs(ESTIMATE));

ok('"Valid through" in column A does not label the totals block in column J',
  has(estimate, 'Valid through', '21-Nov-2026'), pairs(ESTIMATE));
ok('"FOB Point" in column A does not label the service total either',
  has(estimate, 'FOB Point', 'None'), pairs(ESTIMATE));

// What the totals block should say once it is read within its own columns.
ok('the totals block pairs within itself', has(estimate, 'Product Total', '0.00'), pairs(ESTIMATE));
ok('...including the one whose label carries a stray space before its colon',
  has(estimate, 'Service Total', '0.00'), pairs(ESTIMATE));
ok('...and the two that already worked keep working',
  has(estimate, 'Subscription Total', '1234.00') && has(estimate, 'Total Price', '1234.00'),
  pairs(ESTIMATE));

ok('a label and a value in separated columns still pair',
  has(estimate, 'Deal ID', 'NA'), pairs(ESTIMATE));
ok('...and so does a long value',
  has(estimate, 'Price List', 'Global Asia-Pac Price List in US dollars (USD)'), pairs(ESTIMATE));

/* ---------- 2. The self-contained-cell rule itself ---------- */

const oneRow = cells => fieldsOf({ 0: cells, 1: {}, 2: {} });

eq('a cell stating its own value is read as that pair and consumes nothing',
  oneRow({ 0: 'Date: 29-Mar-2026', 1: 'Estimate ID:', 2: 'JD900000001ZZ' })
    .map(f => f.label + ' => ' + f.value).join('|'),
  'Date => 29-Mar-2026|Estimate ID => JD900000001ZZ');
eq('a bare label pairs with the next cell',
  oneRow({ 0: 'Contract No.', 1: 'L260390185MZ' }).length, 1);
eq('a TRAILING colon is punctuation, not a stated value',
  oneRow({ 0: 'Contract No.:', 1: 'L260390185MZ' })[0].label, 'Contract No.');
eq('...even with a space in front of it, as the totals block prints it',
  oneRow({ 0: 'Service Total :', 1: '0.00' })[0].label, 'Service Total');
eq('a stated pair keeps its own value rather than the cell beside it',
  oneRow({ 0: 'Ph no:+852 0000 0000', 1: 'Attn' })[0].value, '+852 0000 0000');
// This is the case that made splitting worth doing rather than just dropping:
// on thirteen real Avaya workbooks the cell is the reference's only appearance.
eq('...even when the label carries a space in front of its colon',
  oneRow({ 0: 'Parent QRN : SHK70527C0', 1: 'Sales Org' })[0].label, 'Parent QRN');
eq('...and even as the LAST cell of its row, which pairs with nothing',
  oneRow({ 0: 'Sales Org: 4A5B Avaya Ireland', 1: 'Parent QRN : SHK70527C0' })
    .map(f => f.label + ' => ' + f.value).join('|'),
  'Sales Org => 4A5B Avaya Ireland|Parent QRN => SHK70527C0');
eq('a bare label as the last cell of its row still pairs with nothing',
  oneRow({ 0: 'Amount', 1: '120.00', 2: 'Currency' }).length, 1);
eq('a URL in a cell is not a label called "https"',
  oneRow({ 0: 'https://support.example.com/a', 1: 'Reference' }).length, 0);

// Distance is explicitly NOT part of the rule. Real Avaya quote workbooks put a
// total's label at the left edge of a wide sheet and its figure at the right,
// and an earlier attempt at this fix -- "cells more than four columns apart are
// different regions" -- lost 280 fields across the corpus to gain 50, including
// "Grand Total = 25,818.24" and "Quote Total Price = 127,117.32". A wide gap
// alone cannot tell a column boundary from a stretched-out form row.
eq('a label and a value at opposite ends of a wide row still pair',
  oneRow({ 0: 'Grand Total', 11: '25,818.24' })[0].value, '25,818.24');

// A row holding two label:value pairs reads both, which the collapse gets right
// on its own -- the first pair consumes its value, so the second label is next.
//
// The values here are amounts on purpose. A four-cell row whose values are
// *reference numbers* (`Agreement Number | L26… | Previous Agreement Number |
// L25…`) loses its first pair instead, because a reference number is itself
// labelish and the "heading, not a label" guard then skips the row's real
// label. That is the same pre-existing off-by-one noted above, it predates this
// change, and App-side `contractNoFromText` is what currently reads that row
// back out of the text.
{
  const two = oneRow({ 0: 'Total Amount', 1: '25,818.24', 9: 'Currency', 10: 'HKD' });
  eq('a row holding two label:value pairs yields two fields', two.length, 2);
  ok('...the left pair reads', has(two, 'Total Amount', '25,818.24'), two);
  ok('...and so does the right one', has(two, 'Currency', 'HKD'), two);
}

// The "heading, not a label" guard is untouched by this change. (Its own
// threshold is a separate matter -- it wants two further cells, so it does not
// fire on the three-cell row the engine's comment gives as its example. Left
// alone on purpose: this file is about which cells may pair at all.)
{
  const heading = oneRow({ 0: 'Quote Info', 1: 'Quote Number', 2: '482022078', 3: 'Rev-2' });
  ok('a section heading in front of a form row is still skipped',
    !heading.some(f => f.label === 'Quote Info'), heading);
  ok('...and the form row behind it still reads',
    has(heading, 'Quote Number', '482022078'), heading);
}

/* ---------- 3. Rows that were never the problem ---------- */

// A data table is skipped whole, by run length, before the gap rule is reached.
{
  const table = fieldsOf({
    0: { 0: 'Part Number', 1: 'Description', 2: 'Qty', 3: 'Unit Price', 4: 'Amount' },
    1: { 0: 'A-1', 1: 'Widget', 2: '2', 3: '10.00', 4: '20.00' },
    2: { 0: 'A-2', 1: 'Gadget', 2: '1', 3: '30.00', 4: '30.00' },
    3: { 0: 'A-3', 1: 'Doohickey', 2: '1', 3: '40.00', 4: '40.00' },
  });
  eq('a data table contributes no fields at all', table.length, 0);
}
{
  const empty = fieldsOf({ 0: {} });
  eq('an empty sheet is not an error', empty.length, 0);
}

/* ---------- which extensions count as a spreadsheet ----------
   The engine's SHEET_EXTS is the single source of truth: previewKindFor and
   parseByExt both read it, so "the viewer shows it" and "the parser reads it"
   cannot drift apart. What CAN drift are the two copies outside the engine --
   the App's VIEWER_SHEET_EXTS fallback (used by the harness and by the paint
   before the loader finishes) and the two drop lists -- so they are pinned
   here, against the engine, by reading the files as text.

   The measured gap this closes is `.xlt`: an Excel TEMPLATE, which a sender
   produces just by saving from a template, and which used to resolve to
   previewKind 'other' -- a filename and a download button, no preview and no
   fields, indistinguishable on screen from a format nothing can read. */
{
  const engineExts = globalThis.DocparseEngine.SHEET_EXTS;
  ok('the engine publishes one spreadsheet list', Array.isArray(engineExts) && engineExts.length > 3);
  ok('...and .xlt is in it, which is the format this was opened for',
    engineExts.indexOf('xlt') !== -1, engineExts);
  ok('...along with the rest of the Excel family',
    ['xlsx', 'xlsm', 'xlsb', 'xls', 'xltx', 'xltm', 'ods', 'csv'].every(e => engineExts.indexOf(e) !== -1),
    engineExts);
  // SheetJS parses these too, and they already resolve to previews that are
  // right far more often. A .txt shown as a one-column table is a regression.
  ok('...and not the formats another preview already claims',
    ['txt', 'html', 'htm', 'pdf'].every(e => engineExts.indexOf(e) === -1), engineExts);

  const { previewKindFor } = globalThis.DocparseEngine;
  ok('every listed extension previews as a sheet',
    engineExts.every(e => previewKindFor(e) === 'sheet'),
    engineExts.filter(e => previewKindFor(e) !== 'sheet'));
  ok('...and .txt still previews as text', previewKindFor('txt') === 'text');

  const listIn = (file, name) => {
    const src = fs.readFileSync(path.join(__dirname, '..', '..', file), 'utf8');
    const at = src.indexOf('const ' + name + ' = [');
    if (at < 0) return null;
    const body = src.slice(at, src.indexOf(';', at));
    return (body.match(/["'][a-z0-9]+["']/g) || []).map(q => q.slice(1, -1));
  };

  const appFallback = listIn('PR Assistant App.html', 'VIEWER_SHEET_EXTS');
  ok('the App carries a fallback list', Array.isArray(appFallback), appFallback);
  ok('...identical to the engine\'s, in the same order',
    JSON.stringify(appFallback) === JSON.stringify(engineExts),
    { app: appFallback, engine: engineExts });

  // Both drop lists spread the spreadsheet list rather than retyping it, which
  // is what keeps a format the engine reads from being turned away at the door.
  const spreads = (file, from) => {
    const src = fs.readFileSync(path.join(__dirname, '..', '..', file), 'utf8');
    const at = src.indexOf('const DROP_PARSABLE_EXTS = [');
    return at >= 0 && src.slice(at, src.indexOf(';', at)).includes('...' + from);
  };
  ok('the App\'s drop list spreads the spreadsheet list',
    spreads('PR Assistant App.html', 'VIEWER_SHEET_EXTS'));
  ok('...and Docparse\'s spreads the engine\'s directly',
    spreads('Docparse/index.html', 'DocparseEngine.SHEET_EXTS'));
}

/* ---------- report ---------- */

if (failures.length) {
  console.error('\n' + failures.length + ' FAILED of ' + (passed + failures.length) + ':\n');
  failures.forEach(f => console.error('  - ' + f));
  process.exit(1);
}
console.log(passed + ' assertions passed, 0 failed');
