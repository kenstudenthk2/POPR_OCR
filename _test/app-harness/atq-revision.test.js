// One ATQ arriving twice at DIFFERENT revisions — DocparseEngine's
// dedupeAtqRecords, plus the App's reading of the answer.
//
//   node _test/app-harness/atq-revision.test.js
//
// The engine half needs no browser: dedupeAtqRecords takes records that are
// already parsed and compares references and filenames, so it runs under plain
// Node with no pdf.js, no XLSX and no OCR.
//
// The fixture is NOT invented. It is the attachment set of a real email —
// "URGENT BTB PR REQUEST (Item 1) - THE UNVERSITY OF HONG KONG -
// (UID-26-08-0063-1)" — whose ATQ arrives as:
//
//   ATQ-202607-00201-V01.xlsx                       Cost worksheet: ONE item
//   ATQ-202607-00201-V022026-08-20T12_10_22.pdf     printed table: TWELVE items
//
// Both were opened directly to confirm those counts. The workbook's Cost sheet
// really is `A1:K2` — a header row and one data row, Item 1 / K09416 / ACW /
// 582799.7 — so the twelve are the whole form, not this requisition's items.
//
// Grouping on the WHOLE reference put the two attachments in two groups. The
// group holding the print therefore had no workbook in it, the
// `if (!group.some(isWorkbookRecord)) return;` guard fired, and nothing was
// dropped: a one-item ATQ offered thirteen items for selection, two of them
// labelled "Item 1". The mechanism was right; the key never considered that the
// same ATQ arrives twice at different revisions.
//
// The trap in fixing it, and the reason `supersededBy` exists rather than this
// being a two-line key change: on this email the WORKBOOK is the older one.
// Preferring it — which is correct for the item LIST, since that is the list
// this requisition covers — keeps V01's values, and V02 was issued precisely
// because a price moved. Dropping the print silently would turn a visible
// duplicate into an invisible wrong number.

const path = require('path');
const fs = require('fs');
const vm = require('vm');

const ENGINE = path.join(__dirname, '..', '..', 'Docparse', 'docparse-engine.js');
vm.runInThisContext(fs.readFileSync(ENGINE, 'utf8'), { filename: 'docparse-engine.js' });
const { dedupeAtqRecords } = globalThis.DocparseEngine;

const { load } = require('./app.js');
const app = load();

let passed = 0;
const failures = [];

function ok(label, cond, detail) {
  if (cond) { passed++; return; }
  failures.push(label + (detail === undefined ? '' : '\n      got: ' + JSON.stringify(detail).slice(0, 400)));
}
function eq(label, actual, expected) {
  ok(label, actual === expected, { actual, expected });
}

const XLSX_V01 = 'ATQ-202607-00201-V01.xlsx';
const PDF_V02 = 'ATQ-202607-00201-V022026-08-20T12_10_22.pdf';

// A record as either producer emits it: same labels from both, which is what
// lets dedupeAtqRecords compare them at all.
function rec(sourceFile, itemNo, ref) {
  return {
    sourceFile,
    fields: [
      { label: 'ATQ Ref. No.', value: ref },
      { label: 'Item No.', value: String(itemNo) },
    ],
  };
}
function offered(kept) {
  return kept.map(r => {
    const item = r.fields.find(f => f.label === 'Item No.').value;
    return item + '@' + (/\.xlsx?$/i.test(r.sourceFile) ? 'xlsx' : 'pdf');
  }).join(' ');
}

/* ---------- the measured email ---------- */

{
  const records = [
    rec(XLSX_V01, 1, 'ATQ-202607-00201-V01'),
    ...Array.from({ length: 12 }, (_, i) => rec(PDF_V02, i + 1, 'ATQ-202607-00201-V02')),
  ];
  const { kept, dropped } = dedupeAtqRecords(records);

  eq('a one-item ATQ offers one item, not thirteen', kept.length, 1);
  eq('and the twelve from the print are the ones dropped', dropped.size, 12);
  eq('the survivor is the workbook\'s Cost-worksheet row', offered(kept), '1@xlsx');
  eq('the item list is the workbook\'s even though the print is NEWER',
    kept[0].sourceFile, XLSX_V01);

  // The half that stops this being a silent wrong number.
  eq('the kept record names the revision that superseded it',
    kept[0].supersededBy, 'ATQ-202607-00201-V02');
}

/* ---------- what must NOT change ---------- */

// The case dedupeAtqRecords was written for. Both attachments at the same
// revision was already handled and must stay byte-for-byte the same.
{
  const { kept, dropped } = dedupeAtqRecords([
    rec('ATQ-202607-00201-V01.xlsx', 1, 'ATQ-202607-00201-V01'),
    ...Array.from({ length: 12 }, (_, i) => rec('ATQ-202607-00201-V01.pdf', i + 1, 'ATQ-202607-00201-V01')),
  ]);
  eq('same revision on both sides still keeps the workbook alone', offered(kept), '1@xlsx');
  eq('...and still drops the print\'s copies', dropped.size, 12);
  eq('...with no notice, because nothing supersedes anything',
    kept[0].supersededBy, undefined);
}

// No workbook at all: the print is all there is, and dropping it would leave a
// requisition with no items. Unchanged.
{
  const { kept, dropped } = dedupeAtqRecords([
    rec(PDF_V02, 1, 'ATQ-202607-00201-V02'),
    rec(PDF_V02, 2, 'ATQ-202607-00201-V02'),
  ]);
  eq('a print with no workbook behind it keeps every item', offered(kept), '1@pdf 2@pdf');
  eq('...and drops nothing', dropped.size, 0);
}

// The identity key cuts the revision off the END. Two genuinely different ATQs
// must not collapse into one group just because the suffix was stripped.
{
  const { kept } = dedupeAtqRecords([
    rec('ATQ-202607-00201-V01.xlsx', 1, 'ATQ-202607-00201-V01'),
    rec('ATQ-202607-00999-V01.xlsx', 1, 'ATQ-202607-00999-V01'),
  ]);
  eq('two different ATQs are still two groups', kept.length, 2);
}

// A record whose ATQ cannot be named is kept from either source -- a duplicate
// is a nuisance a person can see, a dropped item is a wrong requisition.
{
  const nameless = { sourceFile: 'scan.pdf', fields: [{ label: 'Item No.', value: '1' }] };
  const { kept } = dedupeAtqRecords([rec(XLSX_V01, 1, 'ATQ-202607-00201-V01'), nameless]);
  ok('an unnamed record is never dropped', kept.indexOf(nameless) >= 0, offered(kept));
}

/* ---------- "latest revision" among workbooks ---------- */

// Two workbooks is the case where latest-revision genuinely decides, and there
// is no notice: the workbook IS the newest thing in the email.
{
  const { kept, dropped } = dedupeAtqRecords([
    rec('ATQ-202607-00201-V01.xlsx', 1, 'ATQ-202607-00201-V01'),
    rec('ATQ-202607-00201-V02.xlsx', 1, 'ATQ-202607-00201-V02'),
  ]);
  eq('the older workbook is dropped', dropped.size, 1);
  eq('...leaving the newer one', kept[0].sourceFile, 'ATQ-202607-00201-V02.xlsx');
  eq('...and no notice, because nothing newer was left behind',
    kept[0].supersededBy, undefined);
}

// A reference with no revision at all must not read as V0 and lose to one.
// atqRevisionOf answers -1 for exactly this reason.
{
  const { kept } = dedupeAtqRecords([
    rec('ATQ-202607-00201.xlsx', 1, 'ATQ-202607-00201'),
  ]);
  eq('a reference carrying no revision is still its own group', kept.length, 1);
  eq('...and is not stamped as superseded by nothing', kept[0].supersededBy, undefined);
}

/* ---------- the App's reading of it ---------- */

{
  const f = app.supersededRevisionOf;
  const stamped = [{
    fields: [{ label: 'ATQ Ref. No.', value: 'ATQ-202607-00201-V01' }],
    supersededBy: 'ATQ-202607-00201-V02',
  }];

  eq('the notice names the revision on screen', f(stamped).current, 'ATQ-202607-00201-V01');
  eq('...and the newer one it should be checked against', f(stamped).newer, 'ATQ-202607-00201-V02');

  // The overwhelmingly common case: nothing to say. `newer` is what the UI
  // gates on, so an empty string here is what keeps the amber line off the page.
  eq('an ordinary upload says nothing',
    f([{ fields: [{ label: 'ATQ Ref. No.', value: 'ATQ-1-V01' }] }]).newer, '');
  eq('no records at all says nothing', f([]).newer, '');
  eq('and neither does a missing list', f(null).newer, '');

  // A stamped record with no readable reference still has something worth
  // saying -- the UI falls back to "the ATQ workbook" for `current`, but
  // `newer` is the half that must survive.
  eq('a stamped record with no reference still reports the newer revision',
    f([{ fields: [], supersededBy: 'ATQ-202607-00201-V02' }]).newer, 'ATQ-202607-00201-V02');
  eq('...with an empty current, which the UI words around',
    f([{ fields: [], supersededBy: 'ATQ-202607-00201-V02' }]).current, '');
}

/* ---------- report ---------- */

console.log(passed + ' passed, ' + failures.length + ' failed');
if (failures.length) {
  failures.forEach(f => console.log('  FAIL  ' + f));
  process.exit(1);
}
