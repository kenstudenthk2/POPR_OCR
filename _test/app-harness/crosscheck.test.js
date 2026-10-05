// Assertions for the document-versus-document cross-check.
//
//   node _test/app-harness/crosscheck.test.js
//
// No framework: the repo has no test runner outside worker/, and a rung-0 check
// that needs an install before it will run is a rung-0 check nobody runs.
//
// Every conflict case mutates a deep clone of DEMO_ATTACHMENTS. Invented values
// therefore never enter the shipped file, and no corpus document is touched at
// any point -- these fixtures are the ones already in the repo, plus arithmetic.

const { load, demoClone, setDemoField } = require('./app.js');
const app = load();

let passed = 0;
const failures = [];

function ok(label, cond, detail) {
  if (cond) { passed++; return; }
  failures.push(label + (detail === undefined ? '' : '\n      got: ' + JSON.stringify(detail)));
}
function eq(label, actual, expected) {
  ok(label, JSON.stringify(actual) === JSON.stringify(expected),
    actual === undefined ? 'undefined' : { actual, expected });
}

// The whole pipeline for one set of attachments, the way App wires it.
function run(attachments, overrides) {
  const diffs = app.computeFieldDiffs(attachments, 0);
  const census = app.roleCensus(attachments, overrides || {});
  return { diffs, census, cc: app.computeCrosschecks(diffs, census) };
}

const base = run(app.DEMO_ATTACHMENTS);
const roleKeys = app.DOC_ROLES.map(r => r.key);
const slotName = (census, key) =>
  census.assigned[key] ? app.sourceBaseName(census.assigned[key].doc) : null;

/* ---------- roles ---------- */

eq('DOC_ROLES holds three roles in display order',
  roleKeys, ['agreement', 'atq', 'quotation']);

eq('agreement slot', slotName(base.census, 'agreement'), 'Contract-signed.pdf');
eq('quotation slot', slotName(base.census, 'quotation'), 'VQ-2026-1847.pdf');
eq('atq slot prefers the workbook', slotName(base.census, 'atq'), 'ATQ-202604-00177.xlsx');
eq('atq slot counts the workbook behind it', base.census.assigned.atq.also, 1);

/* ---------- the fixture as shipped ----------
   Two disagreements are deliberate (see the demo-data note in the App): `hkd`
   is a real conflict and `vendor` is a softened one, so Demo mode actually
   shows the cross-check instead of a wall of green. Everything else agrees.
   Pinned here because the demo is the only fixture a reviewer ever sees by
   accident -- a third disagreement appearing in it is a defect, not a demo. */

eq('every diff has a crosscheck',
  Object.keys(base.diffs).filter(k => !base.cc[k]), []);
ok('dismissKey is carried through untouched',
  Object.keys(base.diffs).every(k => base.cc[k].dismissKey === base.diffs[k].dismissKey));

eq('customerName agrees across all three roles',
  base.cc.customerName.severity, 'same');
eq('customerName pairs = C(3,2)', base.cc.customerName.pairs.length, 3);
ok('every customerName pair agrees', base.cc.customerName.pairs.every(p => p.agrees));
eq('customerName is one cluster', base.cc.customerName.clusters.length, 1);
eq('that cluster is agreed', base.cc.customerName.clusters[0].state, 'agreed');

// The ATQ slot holds the PDF and the workbook it was printed from. Two files,
// one role -- which is exactly the thing sourceCount used to miscount.
eq('atq holds two documents in one slot',
  base.cc.customerName.roles.atq.docKeys, ['Excel#0', 'ATQ#0']);
ok('and they agree with each other', base.cc.customerName.roles.atq.selfConsistent);
eq('no intra-role split on the shipped fixture',
  Object.keys(base.cc).filter(k => base.cc[k].intra.length), []);

eq('startDate is only in the Agreement and the ATQ',
  base.cc.startDate.pairs.map(p => p.aKey + '|' + p.bKey), ['agreement|atq']);
eq('the Quotation is silent on startDate',
  base.cc.startDate.roles.quotation.state, 'silent');

eq('hkd is cross-checked between the ATQ and the quotation',
  base.cc.hkd.pairs.map(p => p.aKey + '|' + p.bKey), ['atq|quotation']);

// Deliberate disagreement 1: the quotation totals 132,800 against 128,400
// everywhere else. An amount that normalises differently is a different
// amount -- no fuzzy second chance, so this is the demo's amber ⚠.
eq('hkd is the demo conflict', base.cc.hkd.severity, 'different');
eq('the ATQ stands on 128,400',
  base.cc.hkd.clusters[0].roleKeys, ['atq']);
eq('and the quotation stands alone', base.cc.hkd.clusters[1].roleKeys, ['quotation']);
eq('as the dissenter', base.cc.hkd.clusters[1].state, 'dissent');
eq('the click opens the quotation',
  app.crosscheckDissent(base.cc.hkd).fileName, 'VQ-2026-1847.pdf');

// Deliberate disagreement 2: the ATQ abbreviates the vendor. tokenAlike reads
// SYS as SYSTEMS, so this is said on Verify without lighting the field.
eq('vendor is softened, not a conflict', base.cc.vendor.severity, 'similar');
eq('and no capsule wears amber',
  app.fieldCrossCheck(base.cc.vendor).filter(x => x.state === 'dissent').length, 0);
ok('the ATQ slot is still self-consistent -- both its forms abbreviate',
  base.cc.vendor.roles.atq.selfConsistent);

// The demo carries exactly these two and no more. A spelling variant that
// stopped normalising away would show up right here.
eq('nothing else in the demo disagrees',
  Object.keys(base.cc).filter(k => base.cc[k].severity === 'different'), ['hkd']);
eq('and nothing else is even softened',
  Object.keys(base.cc).filter(k => base.cc[k].severity === 'similar'), ['vendor']);

// The honesty fix: a field only one slot reports was previously three green
// ticks claiming a corroboration that never happened.
eq('atqRefNo is unchecked, not green', base.cc.atqRefNo.severity, 'unchecked');
eq('and nothing was paired', base.cc.atqRefNo.pairs.length, 0);
eq('its single cluster reads as lone', base.cc.atqRefNo.clusters[0].state, 'lone');
ok('the sentence says why',
  /nothing to cross-check/.test(app.crosscheckSentence(base.cc.atqRefNo)),
  app.crosscheckSentence(base.cc.atqRefNo));

eq('reference role is the ATQ', base.cc.contractNo.refRole, 'atq');
eq('nothing is unslotted in the demo upload',
  Object.keys(base.cc).filter(k => base.cc[k].unslotted.length), []);

// Pure function, same input, same output.
eq('deterministic',
  JSON.stringify(run(app.DEMO_ATTACHMENTS).cc, (k, v) => (k === 'group' ? undefined : v)),
  JSON.stringify(base.cc, (k, v) => (k === 'group' ? undefined : v)));

/* ---------- conflicts, on clones ---------- */

// The shipped fixture disagrees about `hkd` on purpose, so a case about some
// *other* amount conflict has to start from a pile that agrees -- otherwise it
// measures the demo's own dissent instead of the one it just introduced.
function agreeingClone() {
  return setDemoField(demoClone(app), 'Vendor Quotation',
    'Total Value of Quotation (HKD)', 'HKD 128,400.00');
}

// A workbook that contradicts the PDF printed from it.
{
  const { cc } = run(setDemoField(agreeingClone(), 'Excel', 'Total Value of Quotation (HKD)', '128500'));
  eq('intra-role split is a conflict', cc.hkd.severity, 'different');
  ok('the ATQ slot is no longer self-consistent', !cc.hkd.roles.atq.selfConsistent);
  eq('and is reported as an intra split', cc.hkd.intra.map(x => x.role.key), ['atq']);
  // The reference role is the ATQ, so "open the side that is not the reference"
  // would have opened the Quotation -- the one document with nothing wrong.
  eq('the click opens the workbook, not the innocent Quotation',
    app.crosscheckDissent(cc.hkd).fileName, 'ATQ-202604-00177.xlsx');
  ok('the sentence names the split rather than the partition',
    /gives two different values/.test(app.crosscheckSentence(cc.hkd)),
    app.crosscheckSentence(cc.hkd));
}

// One role against three. The case a chain model (quotation -> agreement -> atq)
// reports in the wrong place, because the Agreement is the middle link.
{
  const { cc } = run(setDemoField(demoClone(app), 'Contract', 'Customer Name', 'XYZ Holdings Ltd'));
  const c = cc.customerName;
  eq('a real disagreement', c.severity, 'different');
  eq('the two that agree are one cluster', c.clusters[0].roleKeys, ['atq', 'quotation']);
  eq('and it is the agreed one', c.clusters[0].state, 'agreed');
  eq('the Agreement stands alone', c.clusters[1].roleKeys, ['agreement']);
  eq('as the dissenter', c.clusters[1].state, 'dissent');
  eq('the pairs not involving the Agreement still agree',
    c.pairs.filter(p => p.aKey !== 'agreement' && p.bKey !== 'agreement').every(p => p.agrees), true);
  eq('the click opens the odd one out',
    app.crosscheckDissent(c).fileName, 'Contract-signed.pdf');
  eq('the capsules draw two groups',
    app.fieldCrossCheck(c).map(x => x.state), ['agreed', 'dissent']);
}

// Our own letterhead read as the counterparty. Softens, and must not ring.
{
  const { cc } = run(setDemoField(demoClone(app), 'Contract', 'Customer Name', app.OUR_COMPANY.label + ' Limited'));
  const c = cc.customerName;
  eq('softened, not a conflict', c.severity, 'similar');
  ok('every dissenting pair says why',
    c.pairs.filter(p => !p.agrees).every(p => /letterhead/.test(p.softReason)));
  eq('and no capsule wears amber',
    app.fieldCrossCheck(c).filter(x => x.state === 'dissent').length, 0);
}

// One document listing every party, the others naming one of them.
{
  const { cc } = run(setDemoField(demoClone(app), 'Excel', 'Vendor / Distributor',
    'Cisco Systems Ltd, Xtreme Lighting Limited'));
  const c = cc.vendor;
  eq('a list covering the rest is softened', c.severity, 'similar');
  ok('with the listing reason, not the wording one',
    c.pairs.concat(c.intra).some(p => /listed among/.test(p.softReason || '')),
    c.pairs.map(p => p.softReason));
}

/* ---------- light-pass upload: a document still owed an OCR read ---------- */

// A deferred-OCR document has no text layer yet, so its heading is unreadable
// -- but its filename still is, and filename beats heading in namedRoleOfSource.
// The slot must still fill, and must say so is pending, so a reviewer sees
// "未讀" rather than a role that silently looks fully read.
{
  const pending = demoClone(app);
  pending.Excel.docs[0].ocrPending = true;
  pending.Excel.docs[0].resumable = true;
  const { census } = run(pending);

  eq('the atq slot still fills from the filename alone',
    slotName(census, 'atq'), 'ATQ-202604-00177.xlsx');
  eq('its heading is unreadable while OCR is pending',
    app.headingRoleOf(app.docHeadingLines(pending.Excel, pending.Excel.docs[0])), null);
  ok('the slot carries the pending flag through to the UI',
    census.assigned.atq.doc.ocrPending === true);
  ok('and the resumable flag alongside it',
    census.assigned.atq.doc.resumable === true);
  ok('an untouched document in the same upload is not marked pending',
    census.assigned.agreement.doc.ocrPending === false);
}

/* ---------- Item No. anchoring: form-fill and cross-check must agree ----------
   Regression for a historical bug: detectFromRoles picked records[itemIndex] by
   position while computeFieldDiffs paired records by "Item No." -- on a
   workbook narrowed to a subset of a form's items the two anchored on
   different rows. Both now go through the same anchorRecordsOf/anchoredRecordOf,
   so this proves they can no longer disagree. */
{
  const rec = (itemNo, extra) => ({ fields: [{ label: "Item No.", value: itemNo }].concat(extra || []) });

  // The workbook a reviewer narrowed to just items 2 and 3 -- Item No. "1"
  // never appears, so its positions (0, 1) hold "2" and "3". Scanned first
  // (ATTACHMENT_TYPES puts ATQ ahead of Excel), so it is the anchor source.
  const narrowed = {
    "Vendor Quotation": { parsed: false, docs: [] },
    "Contract": { parsed: false, docs: [] },
    "ATQ": { parsed: true, file: "ATQ.xlsx", docs: [], records: [rec("2"), rec("3")] },
    // The full-coverage document (e.g. a PDF print of the same ATQ, or a
    // second role entirely) -- item "1" sits at position 0, so picking by
    // position would read item 1's vendor while the anchor names item 2.
    "Excel": { parsed: true, file: "ATQ-print.pdf", docs: [], records: [
      rec("1", [{ label: "Vendor / Distributor", value: "Vendor-For-Item-1" }]),
      rec("2", [{ label: "Vendor / Distributor", value: "Vendor-For-Item-2" }]),
      rec("3", [{ label: "Vendor / Distributor", value: "Vendor-For-Item-3" }]),
    ] },
  };

  eq('Item tab 0 anchors on the narrowed workbook\'s Item No. "2", not position 0 of the full document',
    app.anchorRecordsOf(narrowed, 0).anchorItemNo, "2");

  const excelRecords = narrowed.Excel.records;
  const anchored = app.anchoredRecordOf(excelRecords, narrowed, 0);
  eq('anchoredRecordOf on the full-coverage document picks the same Item No. as the anchor',
    app.itemNoOf(anchored), "2");
  ok('and it is not simply the positional record (that would be item "1")',
    anchored !== excelRecords[0]);

  // computeFieldDiffs walks the same attachments and must land on the same row
  // -- the ATQ entry carries no vendor field, so Excel is the only contributor
  // and its group value shows which item's row computeFieldDiffs actually read.
  const diffs = app.computeFieldDiffs(narrowed, 0);
  eq('computeFieldDiffs also speaks for Item No. "2" on the full-coverage document',
    diffs.vendor.groups.map(g => g.value), ["Vendor-For-Item-2"]);
}

/* ---------- role reassignment, and the memo dependency split ---------- */

// Pinning the workbook to the ATQ slot takes the role off the PDF print
// (roleOfSource's second rule) without disturbing the diff underneath it -- the
// proof that computeFieldDiffs has no business depending on roleOverrides.
{
  const pinned = run(app.DEMO_ATTACHMENTS, { atq: 'Excel#0' });
  eq('the diff is byte-identical under a role pin',
    JSON.stringify(pinned.diffs), JSON.stringify(base.diffs));
  eq('the ATQ slot is now the workbook alone',
    pinned.cc.customerName.roles.atq.docKeys, ['Excel#0']);
  eq('and the PDF print fills no slot at all',
    pinned.cc.customerName.unslotted.map(u => u.source.typeKey), ['ATQ']);
  ok('an unslotted document joins no pair',
    pinned.cc.customerName.pairs.every(p => p.aKey !== null && p.bKey !== null));
}

/* ---------- Verify's gate ---------- */

// Every attachment type is required now, so a missing one has to be seen.
{
  const missing = demoClone(app);
  missing['Contract'] = { parsed: false, file: null };
  ok('a full upload parses every type',
    app.ATTACHMENT_TYPES.every(t => demoClone(app)[t] && demoClone(app)[t].parsed));
  eq('and a missing type is named', 
    app.ATTACHMENT_TYPES.filter(t => !missing[t].parsed), ['Contract']);
}

/* ---------- the two remark templates ---------- */
{
  // Only the keys buildToSupplierRemark reads. A whole DEMO fields object would
  // make this pass or fail on values that have nothing to do with the sentence.
  const f = {
    quotationStartDate: { value: '' }, quotationEndDate: { value: '' },
    customerName: { value: 'ABC Company Ltd' }, vendor: { value: 'Nice Systems BV' },
    poPrDescription: { value: 'Maintenance' },
  };
  const first = text => text.split('\n')[0];

  // The dev side's opening line names the Admin the reviewer picked, in
  // BTB_ADMINS' own spelling, followed by THAT person's extension. The line used
  // to read a hard-coded "Mandy Lee@28833100", and 28833100 is Mandy's alone --
  // carrying it over to another name would be a wrong number, which is worse
  // than a missing one, so the number is looked up per Admin.
  eq('To Supplier opens with the selected Admin Name and THEIR extension',
    first(app.buildToSupplierRemark('C716', f, null, false, 'Chow, Alice SW')),
    'PR Issued by Chow, Alice SW@28831026');
  ok('...not the hard-coded number, which belongs to somebody else',
    app.buildToSupplierRemark('C716', f, null, false, 'Chow, Alice SW').indexOf('28833100') < 0);
  // Two of the ten have no extension on the transcribed list. A bare name is
  // the right answer there; a trailing "@" reads as a number that failed to
  // load, and any number at all would be the wrong person's.
  eq('an Admin with no extension prints the name alone, with no dangling @',
    first(app.buildToSupplierRemark('C716', f, null, false, 'Pang, Joey CY')),
    'PR Issued by Pang, Joey CY');
  // A lone backslash is not a JS escape here: written with one, this entry was silently
  // the string "IPTSPMO (BPM)", in the dropdown and in both sentences.
  ok('the one name carrying a backslash keeps it',
    app.BTB_ADMIN_NAMES.indexOf('IPTS' + String.fromCharCode(92) + 'PMO (BPM)') >= 0,
    JSON.stringify(app.BTB_ADMIN_NAMES));
  // The names list is DERIVED from the one with the phones, so there is a
  // single transcription of these ten people rather than two to keep in step.
  eq('every Admin name has a row in the list the phones come from',
    app.BTB_ADMIN_NAMES.filter(n => !app.BTB_ADMINS.some(a => a.name === n)), []);
  eq('...and the two lists are the same ten, in the same order',
    app.BTB_ADMINS.map(a => a.name), app.BTB_ADMIN_NAMES);
  // The BTB sentence has never printed a phone for the Admin and still does not
  // -- only the To Supplier line does.
  ok('the BTB copy-to line prints the name WITHOUT the extension',
    app.buildBtbRemark(app.BTB_SALES_CONTACTS[0], 'Chow, Alice SW').indexOf('28831026') < 0);

  // The contact is named TWICE at the end of the BTB sentence: once in the CC
  // list as "Chan, Abby NY(sales)", once after it as "Ms. Abby Chan at 2883
  // 0385". The dev side (FEATURES.btbBuyerSignoff false) drops the SECOND one.
  const c0 = app.BTB_SALES_CONTACTS[0];
  const withSignoff = app.buildBtbRemark(c0, 'Lee, Mandy MY', true);
  const noSignoff = app.buildBtbRemark(c0, 'Lee, Mandy MY', false);
  ok('the dev BTB sentence ends at the CC entry',
    noSignoff.endsWith(c0.key + '(sales)'), noSignoff);
  ok('...so the contact is named once, not twice',
    noSignoff.indexOf(c0.name) < 0 && noSignoff.indexOf(c0.key) >= 0, noSignoff);
  // The whole trailing clause goes, phone included -- "at 2883 0385" left
  // standing with the name cut out of it is a broken sentence, not a shorter
  // one.
  ok('...and no orphaned phone is left behind',
    noSignoff.indexOf(c0.phone) < 0 && noSignoff.indexOf(' at ') < 0, noSignoff);
  // Optional and defaulting to TRUE, which is what keeps the Admin side and
  // UploadPage's one-argument call byte-for-byte unchanged.
  eq('omitting the argument leaves the sentence exactly as it was',
    app.buildBtbRemark(c0, 'Lee, Mandy MY'), withSignoff);
  eq('...as does the one-argument call',
    app.buildBtbRemark(c0), withSignoff);
  ok('...and that sentence still carries the trailing sign-off',
    withSignoff.endsWith(c0.phone), withSignoff);

  // The argument is OPTIONAL and absent means the line as it has always read --
  // this is what keeps the Admin side (FEATURES.toSupplierIssuedBy is false
  // there) and the other component's two-argument call byte-for-byte unchanged.
  eq('...and omitting it leaves the original hard-coded line alone',
    first(app.buildToSupplierRemark('C716', f)),
    'PR Issued by Mandy Lee@28833100');
  eq('...including the four-argument call the Admin side makes',
    first(app.buildToSupplierRemark('C716', f, null, false)),
    'PR Issued by Mandy Lee@28833100');

  // Same name, two sentences: the BTB "copy to" line has named the picked Admin
  // all along, and the To Supplier line now names it too, so one selection has
  // to spell it identically in both.
  const contact = app.BTB_SALES_CONTACTS[0];
  ok('the BTB remark names the same Admin, spelled the same way',
    app.buildBtbRemark(contact, 'Chow, Alice SW').indexOf('copy to Chow, Alice SW;') >= 0,
    app.buildBtbRemark(contact, 'Chow, Alice SW'));
}

/* ---------- report ---------- */

console.log(passed + ' passed, ' + failures.length + ' failed');
if (failures.length) {
  failures.forEach(f => console.log('  FAIL  ' + f));
  process.exit(1);
}
