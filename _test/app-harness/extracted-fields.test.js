// Assertions for the Extracted Fields preview page (Process -> Verify):
// signatureDetectionLabel, roleCellValue, and a render test for
// ExtractedFieldsPage.
//
//   node _test/app-harness/extracted-fields.test.js
//
// The page is a document-vs-document grid (rows = the fields computeFieldDiffs
// already cross-checks, columns = Agreement / Quotation / ATQ (Excel), built
// entirely on computeCrosschecks' own per-role grouping rather
// than a second comparison pass -- so this test drives it the same way: real
// attachments through computeFieldDiffs -> roleCensus -> computeCrosschecks,
// never a bespoke fixture shape the page would never see.
//
// Rewritten after the columns stopped being attachment tabs and became roles.
// The old version called extractedCellValue(diff, typeKey) and read
// EXTRACTED_FIELD_COLUMNS[].typeKey; a whole email dropped into one tab put
// every document under that one typeKey, so a typeKey-keyed column found only
// the tab it was literally dropped into. Columns are keyed by DOC_ROLES role
// now, and the ATQ's PDF print and the workbook behind it are told apart by
// `kind` rather than by which tab they arrived on.

const { load, demoClone, setDemoField } = require('./app.js');
const { renderToStaticMarkup } = require('react-dom/server');
const React = require('react');

const app = load({ react: true });
const stub = load(); // for the pure helpers, which do not care about React

let passed = 0;
const failures = [];

/* ---------- Dataverse Verify Table projection ---------- */

eq('Agreement uses the confirmed Dataverse logical table name',
  stub.DATAVERSE_VERIFY_SOURCES.agreement.entity, 'admin_btb_agreements');
eq('Quotation uses the confirmed Dataverse logical table name',
  stub.DATAVERSE_VERIFY_SOURCES.quotation.entity, 'admin_btb_vendor_quotations');
eq('Dataverse query selects only the Verify Table fields',
  stub.dataverseVerifyQuery('RID-001', stub.DATAVERSE_VERIFY_SOURCES.agreement),
  "?$select=admin_title2,admin_customername2,admin_contractnumber2,admin_contractstartdate2,admin_contractenddate2,admin_totalchargehkd2,admin_pagenumber2,admin_signaturedetection2&$filter=admin_title2 eq 'RID-001'");
const dvAgreement = stub.dataverseVerifyRecord('agreement', {
  admin_title2: 'RID-001', admin_customername2: 'ABC Ltd', admin_contractnumber2: 'C-9',
  admin_contractstartdate2: '2026-01-01T00:00:00Z', admin_contractenddate2: '2026-12-31T00:00:00Z',
  admin_totalchargehkd2: 1250, admin_totalchargeusd2: 160,
});
eq('Dataverse Agreement maps customer name', dvAgreement.customerName, 'ABC Ltd');
eq('Dataverse Agreement maps contract number', dvAgreement.contractNo, 'C-9');
eq('Dataverse Agreement maps dates', dvAgreement.startDate + '|' + dvAgreement.endDate, '2026-01-01|2026-12-31');
eq('Dataverse Agreement maps HKD amount', dvAgreement.hkd, '1250');
eq('Dataverse projection ignores unrelated columns', dvAgreement.vendor, undefined);
const dvQuotation = stub.dataverseVerifyRecord('quotation', {
  admin_title2: 'RID-001', admin_customername2: 'ABC Ltd', admin_vendorname2: 'Vendor Ltd',
  admin_quotationrefnumber2: 'Q-7', admin_maintenanceperiodstart2: '2026-02-01T00:00:00Z',
  admin_maintenanceperiodend2: '2027-01-31T00:00:00Z', admin_totalvaluehkd2: 2500,
});
eq('Dataverse Quotation maps vendor and reference', dvQuotation.vendor + '|' + dvQuotation.quotation, 'Vendor Ltd|Q-7');
eq('Dataverse Quotation maps maintenance dates and HKD',
  dvQuotation.startDate + '|' + dvQuotation.endDate + '|' + dvQuotation.hkd, '2026-02-01|2027-01-31|2500');
eq('OData filter escapes apostrophes in Record_ID',
  stub.dataverseVerifyQuery("RID-'002", stub.DATAVERSE_VERIFY_SOURCES.agreement).includes("RID-''002"), true);

function ok(label, cond, detail) {
  if (cond) { passed++; return; }
  failures.push(label + (detail === undefined ? '' : '\n      got: ' + JSON.stringify(detail).slice(0, 400)));
}
function eq(label, actual, expected) {
  ok(label, actual === expected, { actual, expected });
}
function renders(label, el) {
  try {
    const html = renderToStaticMarkup(el);
    passed++;
    return html;
  } catch (err) {
    failures.push(label + '\n      ' + (err && err.message));
    return '';
  }
}

/* ---------- signatureDetectionLabel ---------- */

eq('no signing at all -> blank, not a guess', stub.signatureDetectionLabel(null), '');
eq('inspected but neither mark found -> blank', stub.signatureDetectionLabel({ hasSignature: false, hasChop: false }), '');
eq('signature only', stub.signatureDetectionLabel({ hasSignature: true, hasChop: false }), 'Signed');
eq('chop only', stub.signatureDetectionLabel({ hasSignature: false, hasChop: true }), 'Chopped');
eq('both', stub.signatureDetectionLabel({ hasSignature: true, hasChop: true }), 'Signed & Chopped');

/* ---------- markDetections ----------
   What the Company Chop row draws instead of that one-line summary. The marks
   below are shaped like the engine's: `page` stamped on by summarizeSigning,
   `context` attached by attachMarkContext (opt-in, and all four App call sites
   ask for it). The two names are the real pair off `Demo Data/chop/Maintenance
   Service Agreement (Customer signed).pdf` -- HKT signs and chops on the left,
   the customer chops on the right -- because "ours" and "theirs" both being
   present on one page is the case this row exists to describe. */

const SIGNED_MARKS = [
  { kind: 'chop', page: 1, color: 'red', confidence: 0.82,
    context: { name: "Hospital Authority - TWGHS, Int'l Funeral Parlour",
      cue: 'For and on behalf of', label: "Customer's Signature & Company Chop" } },
  { kind: 'chop', page: 1, color: null, confidence: 0.74,
    context: { name: 'Hong Kong Telecommunications (HKT) Limited', cue: 'Yours sincerely', label: '' } },
  { kind: 'signature', page: 1, confidence: 0.9,
    context: { name: 'Hong Kong Telecommunications (HKT) Limited', cue: 'Yours sincerely', label: '' } },
];
const SIGNED_SIGNING = { inspected: 1, pagesNotInspected: 0, signatureBlock: true,
  hasSignature: true, hasChop: true, marks: SIGNED_MARKS };

const detected = stub.markDetections(SIGNED_SIGNING, 'chop');
eq('one entry per mark of the kind asked for, not one summary', detected.length, 2);
eq('the counterparty keeps its name', detected[0].name, "Hospital Authority - TWGHS, Int'l Funeral Parlour");
eq('and is not ours', detected[0].ours, false);
eq('our own chop keeps its entry rather than being filtered out', detected[1].ours, true);
eq('and its name too -- greying is the caller\'s job, not a deletion',
  detected[1].name, 'Hong Kong Telecommunications (HKT) Limited');
eq('the page travels with the mark, because the View link is what needs it',
  detected[0].page, 1);
eq('the detector\'s own numbers are passed through, not interpreted',
  detected[0].confidence, 0.82);
eq('and its ink colour', detected[0].color, 'red');
eq('the sign-off block the name was read out of is kept as provenance',
  detected[0].cue, 'For and on behalf of');
eq('signatures are the same call with the other kind',
  stub.markDetections(SIGNED_SIGNING, 'signature').length, 1);
eq('no signing at all is an empty list, not a throw', stub.markDetections(null, 'chop').length, 0);
eq('a result that knows a chop was found but kept no marks reports none here',
  stub.markDetections({ hasChop: true }, 'chop').length, 0);

// A ring found with no readable sign-off block above it. The row says so; it
// must not be dropped, and it must not borrow a name from the other mark.
const unnamed = stub.markDetections({ marks: [{ kind: 'chop', page: 3, confidence: 0.41 }] }, 'chop');
eq('an unowned chop is still a chop', unnamed.length, 1);
eq('with no name invented for it', unnamed[0].name, '');
eq('and not claimed as ours', unnamed[0].ours, false);
eq('on the page it was actually found on', unnamed[0].page, 3);

ok('every entry carries a distinct key -- they are React keys',
  new Set(detected.map(d => d.key)).size === detected.length, detected.map(d => d.key));

/* ---------- roleCellValue, on the shipped demo ----------
   The demo carries the two disagreements the App's own demo-data note
   describes: the quotation totals 132,800 where the ATQ says 128,400, and the
   two ATQ forms word the vendor differently. */

function pipeline(attachments, itemIndex) {
  const diffs = stub.computeFieldDiffs(attachments, itemIndex || 0);
  const census = stub.roleCensus(attachments, null,
    stub.offItemQuotationTest(attachments, itemIndex || 0));
  return { diffs, census, crosschecks: stub.computeCrosschecks(diffs, census) };
}

const demo = app.DEMO_ATTACHMENTS;
const base = pipeline(demo);
const cell = (key, roleKey, kind) => stub.roleCellValue(base.crosschecks, key, roleKey, kind);

eq('a role that reported the field reads its value', cell('customerName', 'agreement'), 'ABC Company Ltd');
eq('every role in the same group reads the same value', cell('customerName', 'quotation'), 'ABC Company Ltd');
eq('a role that never mentions the field is blank, not fabricated', cell('vendor', 'agreement'), '');

const withoutQuotation = demoClone(app);
withoutQuotation['Vendor Quotation'] = { parsed: false, file: null };
eq('and a role absent from the upload is blank, not a guess',
  stub.roleCellValue(pipeline(withoutQuotation).crosschecks, 'hkd', 'quotation'), '');

// The deliberate conflict, one column each side of it.
eq('the quotation\'s own total', cell('hkd', 'quotation'), 'HKD 132,800.00');
eq('and the ATQ Excel source remains available', cell('hkd', 'atq', 'excel'), '128,400.00');
ok('the quotation still disagrees with the ATQ Excel source', cell('hkd', 'quotation') !== cell('hkd', 'atq', 'excel'));
eq('and the field is graded "different"', base.crosschecks.hkd.severity, 'different');

// The ATQ workbook remains a distinct Verify Table source.
eq('the workbook side of the ATQ slot', cell('startDate', 'atq', 'excel'), '2026-01-01');
eq('un-narrowed, the slot still answers', cell('startDate', 'atq'), '2026-01-01');

// The form's Vendor must come from the selected Cost row, not the ATQ PDF's
// document-level Vendor value. This mirrors the workbook shape produced when
// the ATQ Excel file is assigned to the ATQ role.
{
  const cost = demoClone(app);
  cost.Excel.docs[0].records = [{ fields: [
    { label: 'Item No.', value: '1' },
    { label: 'Vendor / Distributor', value: 'Cost Sheet Vendor Ltd' },
  ] }];
  const workbookCensus = { assigned: {
    atq: { doc: { typeKey: 'Excel', docIndex: 0, pagesIndex: 0, fileName: 'ATQ-202604-00177.xlsx' } },
  } };
  eq('the selected ATQ Cost row supplies Vendor',
    stub.atqCostFieldForItem(cost, workbookCensus, 0, 'vendor'), 'Cost Sheet Vendor Ltd');
}

// A real workbook also carries a document-level vendor list assembled from
// the sheet. The selected Cost row must win over that aggregate in the table.
{
  const cost = demoClone(app);
  const costRows = [
    { fields: [{ label: 'Item No.', value: '2' }, { label: 'Vendor / Distributor', value: 'NEXUS2S' }] },
    { fields: [{ label: 'Item No.', value: '3' }, { label: 'Vendor / Distributor', value: 'Xtreme Lighting Limited' }] },
  ];
  cost.Excel.records = costRows;
  cost.Excel.docs[0].records = costRows;
  cost.Excel.docs[0].fields = cost.Excel.docs[0].fields.map(f =>
    f.label === 'Vendor / Distributor'
      ? { label: f.label, value: 'HKT,NEXUS2S,Xtreme Lighting Limited' }
      : f);
  const itemTwo = pipeline(cost, 0);
  const itemThree = pipeline(cost, 1);
  eq('ATQ Excel item 2 uses the Cost vendor',
    stub.roleCellValue(itemTwo.crosschecks, 'vendor', 'atq', 'excel'), 'NEXUS2S');
  eq('ATQ Excel item 3 uses the Cost vendor',
    stub.roleCellValue(itemThree.crosschecks, 'vendor', 'atq', 'excel'), 'Xtreme Lighting Limited');
}

{
  const atq = demoClone(app);
  atq.Excel.docs[0].fields.push({ label: 'Contract Revenue_New', value: '715,657.72' });
  atq.Excel.records = [{ fields: [{ label: 'Item No.', value: '1' }, { label: 'Total Value of Quotation (HKD)', value: '128400' }] }];
  atq.Excel.docs[0].records = atq.Excel.records;
  const workbookCensus = { assigned: {
    atq: { doc: { typeKey: 'Excel', docIndex: 0, pagesIndex: 0, fileName: 'ATQ-202604-00177.xlsx' } },
  }, docs: [{ role: 'atq', typeKey: 'Excel', docIndex: 0, pagesIndex: 0, fileName: 'ATQ-202604-00177.xlsx' }] };
  eq('Contract Revenue uses ATQ sheet Contract Revenue_New, not the Cost quotation total',
    stub.atqWorkbookField(atq, workbookCensus, 'contractRevenue'), '715,657.72');
  eq('PR Amount still uses the selected Cost row Total Value of Quotation (HKD)',
    stub.atqCostFieldForItem(atq, workbookCensus, 0, 'hkd'), '128400');
}

eq('a field no document reports at all', cell('uid', 'atq'), '');
eq('a key with no crosscheck at all -> blank, not a throw',
  stub.roleCellValue({}, 'customerName', 'agreement'), '');

/* ---------- EXTRACTED_FIELD_COLUMNS / EXTRACTED_FIELD_ROWS shape ---------- */

ok('exactly three document columns (ATQ PDF stays out)',
  stub.EXTRACTED_FIELD_COLUMNS.length === 3, stub.EXTRACTED_FIELD_COLUMNS.map(c => c.key));
ok('every column names a real DOC_ROLES role',
  stub.EXTRACTED_FIELD_COLUMNS.every(c => stub.DOC_ROLES.some(r => r.key === c.roleKey)),
  stub.EXTRACTED_FIELD_COLUMNS.map(c => c.roleKey));
ok('the ATQ column is the Excel source',
  stub.EXTRACTED_FIELD_COLUMNS.filter(c => c.roleKey === 'atq')
    .map(c => c.kind).join(',') === 'excel');
ok('the removed ATQ PDF label is absent',
  !stub.EXTRACTED_FIELD_COLUMNS.some(c => c.label === 'ATQ (PDF)'));
ok('every column key is unique -- they are React keys',
  new Set(stub.EXTRACTED_FIELD_COLUMNS.map(c => c.key)).size === stub.EXTRACTED_FIELD_COLUMNS.length);
// Every row is either something the columns can answer, or one of the two the
// columns explicitly cannot -- there is no third kind. A row that is neither is
// a row that renders a blank label and four blank cells.
const spans = k => k in stub.SPANNING_ROWS;
ok('every row is a cross-checked key or a declared spanning row',
  stub.EXTRACTED_FIELD_ROWS.every(k =>
    spans(k) || (k in stub.DIFF_KEYS) || stub.COMPARE_ONLY_FIELDS.some(f => f.key === k)),
  stub.EXTRACTED_FIELD_ROWS.filter(k =>
    !spans(k) && !(k in stub.DIFF_KEYS) && !stub.COMPARE_ONLY_FIELDS.some(f => f.key === k)));
// Spanning rows (ATQ Ref. No. / UID # / Record ID) are drawn in the
// reference strip above the table now, not as rows in the field grid -- so
// the row list and SPANNING_ROWS are disjoint, not the row list containing
// the spans it used to.
ok('no spanning row is also in the field row list -- it would render twice',
  Object.keys(stub.SPANNING_ROWS).every(k => stub.EXTRACTED_FIELD_ROWS.indexOf(k) < 0),
  Object.keys(stub.SPANNING_ROWS).filter(k => stub.EXTRACTED_FIELD_ROWS.indexOf(k) >= 0));
ok('every spanning row states where its value came from',
  Object.values(stub.SPANNING_ROWS).every(r => r.label && r.from));

/* ---------- FIELD_ROW_CONFIG: which rows compare against which documents ---------- */

// Customer Name / Vendor / Total Value (HKD) / Start Date / End Date genuinely
// appear on Agreement, Quotation and the ATQ workbook alike, so all five
// compare against both other documents.
['customerName', 'vendor', 'hkd', 'startDate', 'endDate'].forEach(k => {
  ok(`${k} compares against both Agreement and Quotation`,
    (stub.FIELD_ROW_CONFIG[k] || {}).compare &&
    stub.FIELD_ROW_CONFIG[k].compare.slice().sort().join(',') === 'agreement,quotation',
    stub.FIELD_ROW_CONFIG[k]);
});
// Agreement Number only ever appears on the Agreement -- comparing it against
// the Quotation, which never states a contract number, would just show
// "not extracted" every time and teach a reviewer to ignore that column.
ok('contractNo compares only against the Agreement',
  (stub.FIELD_ROW_CONFIG.contractNo || {}).compare.join(',') === 'agreement',
  stub.FIELD_ROW_CONFIG.contractNo);
// Quotation No. compares only against the Quotation document, and only when
// the ATQ workbook actually has a value of its own to compare (soloRole is
// the fallback for when it does not -- see the render tests below).
ok('quotation compares only against the Quotation document, with a solo fallback',
  (stub.FIELD_ROW_CONFIG.quotation || {}).compare.join(',') === 'quotation' &&
  stub.FIELD_ROW_CONFIG.quotation.soloRole === 'quotation',
  stub.FIELD_ROW_CONFIG.quotation);
// Product Type / Service Type / Back-to-Back only ever come from the ATQ
// workbook -- cross-checking them against documents that never state them
// would manufacture a disagreement out of silence, not report a real one.
['productType', 'serviceType', 'backToBack'].forEach(k => {
  ok(`${k} is solo -- no cross-check`, (stub.FIELD_ROW_CONFIG[k] || {}).solo === true,
    stub.FIELD_ROW_CONFIG[k]);
});
// Every row in the table has a config entry naming its comparison shape --
// none silently falls through to the compare-both-documents default.
ok('every field row has its own FIELD_ROW_CONFIG entry',
  stub.EXTRACTED_FIELD_ROWS.every(k => k in stub.FIELD_ROW_CONFIG),
  stub.EXTRACTED_FIELD_ROWS.filter(k => !(k in stub.FIELD_ROW_CONFIG)));
// A compare row's roles are always a subset of the real document columns
// (Agreement / Quotation) -- never "atq" itself, which would offer ATQ
// (Excel) as one of its own witnesses in the breakdown panel.
Object.keys(stub.FIELD_ROW_CONFIG).forEach(k => {
  const cfg = stub.FIELD_ROW_CONFIG[k];
  if (!cfg.compare) return;
  ok(`${k}'s compare list never includes "atq" -- that is the row's own value`,
    cfg.compare.indexOf('atq') < 0, cfg.compare);
});

/* ---------- recordIdForItem: the preview must not do its own arithmetic ---------- */

// The whole point is that this reads off savePlans -- the same list goSave
// writes from -- so the -a/-b suffix assignRecordIds adds on a collision shows
// up here too. Recomputing from recordIdFor would silently drop it.
{
  const plans = [
    { recordId: 'ATQ-000000-00000-V01-4' },
    { recordId: 'ATQ-000000-00000-V01-10' },
    { recordId: 'ATQ-000000-00000-V01-10-b' },
  ];
  eq('the selected item\'s id', stub.recordIdForItem(plans, 1), 'ATQ-000000-00000-V01-10');
  eq('a collision suffix is carried through, not recomputed away',
    stub.recordIdForItem(plans, 2), 'ATQ-000000-00000-V01-10-b');
  eq('item 0 by default', stub.recordIdForItem(plans, 0), 'ATQ-000000-00000-V01-4');
  // A single-item upload has one plan whatever the item tab says, and an item
  // tab can outlive the records behind it for a render.
  eq('an index past the end clamps rather than crashing',
    stub.recordIdForItem([{ recordId: 'PR-000000000000' }], 7), 'PR-000000000000');
  eq('a negative index clamps too', stub.recordIdForItem(plans, -3), 'ATQ-000000-00000-V01-4');
  eq('no plans is "", not undefined', stub.recordIdForItem([], 0), '');
  eq('no list at all is "" too', stub.recordIdForItem(null, 0), '');
  eq('a plan with no id of its own is ""', stub.recordIdForItem([{}], 0), '');
}

/* ---------- render ---------- */

const noop = () => {};
const pageProps = {
  attachments: demo, crosschecks: base.crosschecks, census: base.census,
  itemIndex: 0, selectItem: noop, goVerify: noop,
};
const html = renders('ExtractedFieldsPage renders on the demo fixture',
  React.createElement(app.ExtractedFieldsPage, pageProps));

// The Verify Table is a 5-column layout: Field, Status (hidden), Value (ATQ Excel),
// Cross Check (Agreement/Quotation comparison), and LIS Value (placeholder).
ok('the ATQ (Excel) value column is present', html.includes('ATQ (Excel)'));
ok('the rendered table omits ATQ PDF', !html.includes('ATQ (PDF)'));
ok('the Cross Check column header is present', html.includes('Cross Check'));
ok('the LIS Value column header is present', html.includes('LIS Value'));
ok('the Status column header is hidden', html.includes('<th className="px-3 py-2 hidden">Status</th>'));
const rowLabel = k => (stub.SPANNING_ROWS[k] && stub.SPANNING_ROWS[k].label)
  || stub.FIELD_LABELS[k] || stub.COMPARE_ONLY_LABELS[k] || k;
ok('a row for every listed field is drawn',
  stub.EXTRACTED_FIELD_ROWS.every(k => html.includes(rowLabel(k))),
  stub.EXTRACTED_FIELD_ROWS.filter(k => !html.includes(rowLabel(k))));
ok('a mapped field draws its value', html.includes('ABC Company Ltd'));
ok('the post-Process table is titled Verify Table', html.includes('Verify Table'));
ok('a silent cell says so rather than guessing', html.includes('not extracted'));
// The demo's one deliberate conflict (hkd: ATQ Excel 128,400.00 vs the
// quotation's 132,800.00) is graded "different", so its cell carries the
// loud tone -- strong red, bold, on a tinted chip -- not the app's ordinary
// amber, per the redesign's ask for a colour that catches the eye first.
ok('the conflicting row is drawn in the strong red "different" tone', html.includes('text-[#C23934] font-bold'));
ok('and its cell is shaded', html.includes('bg-[#FDEBE9]'));
ok('the page says nothing is saved yet', html.includes('Nothing on this page is saved yet'));
ok('and offers the way forward', html.includes('Continue to Verify'));
ok('the legend explains the colours', html.includes('Agrees across documents') &&
  html.includes('documents disagree') && html.includes('Wording only') &&
  html.includes('Only one document reports it'));

/* ---------- PR Amount currency selector and approval tooltip (dev side) ---------- */
ok('PR Amount renders with currency select', html.includes('aria-label="PR Amount currency"'));
ok('PR Amount currency options include HKD and USD', html.includes('value="HKD"') && html.includes('value="USD"') && html.includes('>HKD</option>') && html.includes('>USD</option>'));
ok('PR Amount renders with approval matrix tooltip button', html.includes('aria-label="PR Amount Approval Matrix"'));
ok('PR Amount approval tooltip card contains approval matrix thresholds', html.includes('Upto HK$') && html.includes('NBTB') && html.includes('BTB'));

/* ---------- the BTB / NON-BTB case under Record ID ---------- */

// Added 2026-09-28, both sides. It reads the SAME crosscheck the Non-BTB save
// gate reads (backToBack / atq / excel) and renders inside the Record ID card
// of the reference strip, so a reviewer sees the case before pressing anything
// rather than only when the gate stops them.
//
// Pinned because it is render-only: nothing writes it, no schema names it, and
// side-schema.test.js cannot see it -- if it stops drawing, every other check
// in this file still passes. All five value shapes are asserted, not just the
// two that draw something: "a blank draws nothing" is the load-bearing half.
// An unreadable Cost sheet reaching the screen as "BTB" would invent exactly
// the answer the gate exists to catch, since the gate triggers on N and would
// wave that blank straight through.
{
  const btbCard = markup => {
    const i = markup.indexOf('Record ID');
    return i < 0 ? '' : markup.slice(i, i + 900);
  };
  const withBtb = value => {
    const a = demoClone(app);
    if (value !== null) a.Excel.docs[0].fields.push({ label: 'Back-to-Back', value: value });
    const p = pipeline(a);
    return btbCard(renders('ExtractedFieldsPage renders with Back-to-Back = ' + JSON.stringify(value),
      React.createElement(app.ExtractedFieldsPage, Object.assign({}, pageProps,
        { attachments: a, crosschecks: p.crosschecks, census: p.census,
          recordId: 'ATQ-2026-0001-1' }))));
  };

  const n = withBtb('N');
  ok('Back-to-Back = N draws NON-BTB under the Record ID', /NON-BTB/.test(n));
  ok('...and not the plain BTB label', !/>BTB</.test(n));

  const y = withBtb('Y');
  ok('Back-to-Back = Y draws BTB under the Record ID', />BTB</.test(y));
  ok('...and not NON-BTB', !/NON-BTB/.test(y));

  // The three silences. Each is a different way the Cost sheet can fail to
  // answer, and none of them may put a case on screen.
  [['an empty value', ''], ['no Back-to-Back field at all', null],
   ['a value that is not Y or N', 'maybe']].forEach(([what, value]) => {
    const h = withBtb(value);
    ok(what + ' draws no case at all', !/NON-BTB/.test(h) && !/>BTB</.test(h));
  });
}

// The Dataverse notice banner (loading / error / ready state) still applies
// -- it is a status line about the read, not a per-column display. Agreement
// and Quotation no longer have a column of their own, but the demo's one
// deliberate conflict (hkd) is flagged, and a flagged row's breakdown panel
// still resolves each source through verifyCellValue exactly as the removed
// columns did -- so a live Dataverse read still shows up there.
const dataverseHtml = renders('ExtractedFieldsPage renders with a ready Dataverse notice',
  React.createElement(app.ExtractedFieldsPage, Object.assign({}, pageProps, {
    recordId: 'ATQ-000000-00000-V01-1',
    source: 'n8n',
    dataverseVerify: {
      source: 'n8n',
      recordId: 'ATQ-000000-00000-V01-1',
      status: 'ready',
      agreement: { customerName: 'Dataverse Customer', contractNo: 'DV-C-1', hkd: '9000' },
      quotation: { customerName: 'Dataverse Customer', vendor: 'Dataverse Vendor', quotation: 'DV-Q-1', hkd: '9100' },
      atqExcel: { customerName: 'ATQ Excel Customer', hkd: '8800' },
      lis: { customerName: 'LIS Customer', hkd: '8500' },
    },
  })));
ok('the good-news notice is still drawn', dataverseHtml.includes('live from Dataverse'));
ok('the flagged row\'s breakdown panel still shows the Dataverse reading',
  dataverseHtml.includes('9000') && dataverseHtml.includes('9100'));
ok('the ATQ value itself is still the document reading, never Dataverse',
  dataverseHtml.includes('ABC Company Ltd'));

/* ---------- the two modes of the Verify Table ----------

   Document mode  -- reached by Process. Every column is what the documents said.
   Dataverse mode -- entered by sending to n8n (`source === "n8n"`). The
                     Agreement and Quotation columns then answer for Dataverse
                     and for nothing else, INCLUDING when it has no row: an
                     empty cell is the finding, not a gap to paper over.

   A document value standing in the Agreement column would read as "Dataverse
   holds this", which is the one question this mode exists to answer. What makes
   the empty column safe is dataverseVerifyNotice below, which names which of
   the five reasons it is -- before that existed, all five looked identical and
   looked like the documents had gone missing. */

const RID = 'ATQ-000000-00000-V01-1';
const EXTRACTED = 'ABC Company Ltd';   // what the demo documents say for customerName
const ready = extra => Object.assign({ source: 'n8n', recordId: RID, status: 'ready',
  agreement: null, quotation: null, atqExcel: null, lis: null }, extra);
const cellOf = (key, roleKey, dv, rid) =>
  stub.verifyCellValue(base.crosschecks, key, roleKey, dv, rid === undefined ? RID : rid);

// Document mode: unchanged by any of this.
eq('with no Dataverse read at all the columns are the documents',
  cellOf('customerName', 'agreement', null), EXTRACTED);
eq('...and a state object that never entered Dataverse mode is the same thing',
  cellOf('customerName', 'agreement', { status: 'idle', recordId: RID }), EXTRACTED);

// Dataverse mode: these two columns stop being about the documents.
const live = ready({
  agreement: { customerName: 'Dataverse Customer', contractNo: 'DV-C-1', hkd: '9000' },
  quotation: { customerName: 'Dataverse Customer', vendor: 'Dataverse Vendor', quotation: 'DV-Q-1', hkd: '9100' },
  atqExcel: { customerName: 'ATQ Excel Customer', vendor: 'ATQ Excel Vendor', hkd: '8800', contractNo: 'ATQ-CON-1' },
  lis: { customerName: 'LIS Customer', vendor: 'LIS Vendor', hkd: '8500', contractNo: 'LIS-CON-1' },
});
eq('a Dataverse value is what the column shows', cellOf('customerName', 'agreement', live), 'Dataverse Customer');
eq('and the Quotation column reads its own table', cellOf('vendor', 'quotation', live), 'Dataverse Vendor');

// The requested behaviour, and the point of the mode: no row for this
// Record_ID means an empty column, not the document's value wearing
// Dataverse's label.
eq('a Record_ID with no row shows nothing rather than the document',
  cellOf('customerName', 'agreement', ready()), '');
eq('...and the same for the Quotation column',
  cellOf('customerName', 'quotation', ready()), '');

// A row Dataverse's schema has no column for is empty too, for the same reason.
// admin_btb_agreements carries no vendor; admin_btb_vendor_quotations no contract
// number.
eq('the Agreement column has no vendor to give', cellOf('vendor', 'agreement', live), '');
eq('the Quotation column has no contract number to give', cellOf('contractNo', 'quotation', live), '');

// The other two columns are never in the mode at all.
eq('the ATQ columns are always the documents',
  cellOf('startDate', 'atq', live), stub.roleCellValue(base.crosschecks, 'startDate', 'atq'));
{
  // The fixture has to CARRY an atq record: with the column check gone an
  // absent one yields "" anyway, and in document mode "" is not what the ATQ
  // column returns -- so this is the shape that tells the two apart.
  const strayAtq = ready({ atq: { startDate: '1999-01-01' } });
  eq('an atq record on the object is ignored -- DATAVERSE_VERIFY_SOURCES is the allow-list',
    cellOf('startDate', 'atq', strayAtq), stub.roleCellValue(base.crosschecks, 'startDate', 'atq'));
  ok('...and that column is not in Dataverse mode either',
    !stub.dataverseIsActive(strayAtq, 'atq'));
}
ok('the two Dataverse columns are exactly the DATAVERSE_VERIFY_SOURCES keys',
  Object.keys(stub.DATAVERSE_VERIFY_SOURCES).sort().join(',') === 'agreement,quotation',
  Object.keys(stub.DATAVERSE_VERIFY_SOURCES));

// A read that has not succeeded is not an answer. The fixtures carry records
// under a non-ready status on purpose: with null records every one of these
// would return "" whether the status is checked or not, so the gate could be
// deleted and they would all still pass.
['loading', 'unavailable', 'error'].forEach(status => {
  const notReady = ready({ status, agreement: { customerName: 'Dataverse Customer' } });
  eq('rows left over from a previous read are not shown while ' + status,
    cellOf('customerName', 'agreement', notReady), '');
});

// Changing the item tab moves the Record_ID while the rows in hand belong to
// the old one.
eq('a read for another Record_ID is not shown against this one',
  cellOf('customerName', 'agreement', live, 'ATQ-000000-00000-V01-2'), '');

// The mode is a property of how the page was reached, not of whether the last
// read worked -- which is why an errored read still leaves the columns in it.
ok('the mode survives a failed read', stub.dataverseIsActive(ready({ status: 'error' }), 'agreement'));
ok('document mode is not entered by having a Record_ID',
  !stub.dataverseIsActive({ status: 'idle', recordId: RID }, 'agreement'));

/* ---------- LIS (BTB_LIS_Excel_Data) column ---------- */

// The LIS source is the third Dataverse table. It carries the same field keys
// as the Agreement/Quotation tables, and lisCellValue reads them off
// dataverseVerify.lis.
eq('the LIS source entity name is correct', stub.DATAVERSE_LIS_SOURCE.entity, 'admin_btb_lis_excel_datas');
eq('lisCellValue reads from the lis record', stub.lisCellValue(live, 'customerName'), 'LIS Customer');
eq('lisCellValue reads vendor from the lis record', stub.lisCellValue(live, 'vendor'), 'LIS Vendor');
eq('lisCellValue reads hkd from the lis record', stub.lisCellValue(live, 'hkd'), '8500');
eq('lisCellValue reads contractNo from the lis record', stub.lisCellValue(live, 'contractNo'), 'LIS-CON-1');
eq('lisCellValue returns empty when no lis record exists', stub.lisCellValue(ready(), 'customerName'), '');
eq('lisCellValue returns empty for a missing key', stub.lisCellValue(live, 'quotation'), '');

/* ---------- ATQ Excel (BTB_ATQ_Excel) column ---------- */

// The ATQ Excel source is the record written by "Send to n8n". The Value column
// reads from this instead of the extracted document fields.
eq('the ATQ Excel source entity name is correct', stub.DATAVERSE_ATQ_EXCEL_SOURCE.entity, 'admin_btb_atq_excels');
eq('atqExcelCellValue reads from the atqExcel record', stub.atqExcelCellValue(live, 'customerName'), 'ATQ Excel Customer');
eq('atqExcelCellValue reads vendor from the atqExcel record', stub.atqExcelCellValue(live, 'vendor'), 'ATQ Excel Vendor');
eq('atqExcelCellValue reads hkd from the atqExcel record', stub.atqExcelCellValue(live, 'hkd'), '8800');
eq('atqExcelCellValue reads contractNo from the atqExcel record', stub.atqExcelCellValue(live, 'contractNo'), 'ATQ-CON-1');
eq('atqExcelCellValue returns empty when no atqExcel record exists', stub.atqExcelCellValue(ready(), 'customerName'), '');
eq('atqExcelCellValue returns empty for a missing key', stub.atqExcelCellValue(live, 'quotation'), '');


/* ---------- why the columns say what they say, on screen ---------- */

const notice = (dv, rid) => stub.dataverseVerifyNotice(dv, rid === undefined ? RID : rid);
eq('nothing to report before any read', notice(null), '');
eq('idle is not a report either', notice({ status: 'idle' }), '');
eq('a read in flight says so', notice(ready({ status: 'loading' })).tone, 'info');
ok('no Record_ID explains itself rather than warning about Dataverse',
  notice(ready({ status: 'unavailable', recordId: '' }), '').text.indexOf('No Record ID') === 0,
  notice(ready({ status: 'unavailable', recordId: '' }), '').text);
ok('outside the Model-Driven App, the reason is the frame, not the data',
  /not running inside the Model-Driven App/.test(notice(ready({ status: 'unavailable' })).text));
ok('a rejected request quotes Dataverse and names all three tables',
  ['boom', 'admin_btb_agreements', 'admin_btb_vendor_quotations', 'admin_btb_lis_excel_datas', 'admin_title2']
    .every(s => notice(ready({ status: 'error', error: 'boom' })).text.includes(s)),
  notice(ready({ status: 'error', error: 'boom' })).text);
// The case a reviewer will actually hit, and the one worth spelling out: it is
// both "n8n has not written yet" and "the tables/column are named something
// else", and the message has to let them tell those apart.
ok('ready with neither row names the tables, the column and the value queried',
  ['admin_btb_agreements', 'admin_btb_vendor_quotations', 'admin_btb_lis_excel_datas', 'admin_title2', RID, 'Refresh']
    .every(s => notice(ready()).text.includes(s)), notice(ready()).text);
ok('one row missing says which one',
  notice(ready({ agreement: { customerName: 'x' } })).text.includes('admin_btb_vendor_quotations'),
  notice(ready({ agreement: { customerName: 'x' } })).text);
eq('all three rows found is reported as good news, not silence', notice(live).tone, 'ok');
ok('a stale read explains the mismatch rather than vanishing',
  /press Refresh/.test(notice(live, 'ATQ-000000-00000-V01-2').text),
  notice(live, 'ATQ-000000-00000-V01-2').text);

/* ---------- Refresh belongs to Dataverse mode ---------- */

// Re-reading Dataverse is only meaningful where these columns are answering for
// it. In document mode the button would be offering to change what the page
// MEANS rather than to refresh what it shows, so it is not drawn. A Record_ID
// is required on top, because the read is a lookup by one.
{
  const refreshProps = extra => Object.assign({}, pageProps, { refreshDataverse: () => {} }, extra);

  // The BUTTON, not the word: dataverseVerifyNotice ends several of its
  // messages with "press Refresh", so a bare includes('Refresh') passes on the
  // notice text alone and proves nothing about the button.
  const hasButton = html => html.includes('Read Agreement, Quotation, and LIS from Dataverse for');

  const documentMode = renders('ExtractedFieldsPage renders in document mode',
    React.createElement(app.ExtractedFieldsPage, refreshProps({ recordId: RID })));
  ok('document mode offers no Refresh', !hasButton(documentMode), 'Refresh drawn in document mode');
  ok('...and the documents are shown', documentMode.includes('ABC Company Ltd'));
  ok('...described as not extracted, which is a document-mode sentence',
    documentMode.includes('not extracted') && !documentMode.includes('not in Dataverse'));

  const inMode = renders('ExtractedFieldsPage renders in Dataverse mode',
    React.createElement(app.ExtractedFieldsPage,
      refreshProps({ recordId: RID, dataverseVerify: live })));
  ok('Dataverse mode offers Refresh', hasButton(inMode), 'no Refresh button');
  ok('...and the button names what it will look up', inMode.includes(RID));

  const noId = renders('ExtractedFieldsPage renders in Dataverse mode with no Record_ID',
    React.createElement(app.ExtractedFieldsPage,
      refreshProps({ recordId: '', dataverseVerify: ready({ recordId: '' }) })));
  ok('with no Record_ID there is nothing to look up, so no button',
    !hasButton(noId), 'Refresh offered with no Record_ID');

  const empty = renders('ExtractedFieldsPage renders a read that found nothing',
    React.createElement(app.ExtractedFieldsPage,
      refreshProps({ recordId: RID, dataverseVerify: ready() })));
  ok('a read that found nothing says so on the page, not in the console',
    empty.includes('admin_btb_agreements') && empty.includes('admin_title2'), 'no notice drawn');
  // The ATQ (Excel) value itself is unaffected -- DATAVERSE_VERIFY_SOURCES has
  // no "atq" entry, so it is always the document reading. But the flagged
  // hkd row's breakdown panel still resolves Agreement and Quotation through
  // verifyCellValue, and a ready read with no row for either one is exactly
  // the "not in Dataverse" case that resolution reports.
  const times = (html, s) => (html.split(s).length - 1);
  ok('the ATQ value is unaffected by a Dataverse read that found nothing',
    times(empty, 'ABC Company Ltd') === times(documentMode, 'ABC Company Ltd'),
    { emptyRead: times(empty, 'ABC Company Ltd'), documentMode: times(documentMode, 'ABC Company Ltd') });
  ok('...and the breakdown panel says "not in Dataverse" for the rows that have no match',
    empty.includes('not in Dataverse'));
}

/* ---------- the email subject as a fifth column ---------- */

// A witness, not a document. It is kept OUT of EXTRACTED_FIELD_COLUMNS on
// purpose -- everything that iterates "the documents" has to keep meaning the
// documents -- and out of computeFieldDiffs, because that machine resolves
// every source down to a role, a file and a page, and a subject line has none
// of those.
ok('the email column is not one of the document columns',
  stub.EXTRACTED_FIELD_COLUMNS.every(c => c.key !== stub.EXTRACTED_EMAIL_COLUMN.key),
  stub.EXTRACTED_FIELD_COLUMNS.map(c => c.key));
ok('every row the subject speaks to is a row the table actually draws',
  Object.keys(stub.SUBJECT_ROW_READERS).every(k => stub.EXTRACTED_FIELD_ROWS.indexOf(k) >= 0),
  Object.keys(stub.SUBJECT_ROW_READERS).filter(k => stub.EXTRACTED_FIELD_ROWS.indexOf(k) < 0));
ok('...and one the cross-check can normalise, since that is how agreement is judged',
  Object.keys(stub.SUBJECT_ROW_READERS).every(k => k in stub.DIFF_KEYS),
  Object.keys(stub.SUBJECT_ROW_READERS).filter(k => !(k in stub.DIFF_KEYS)));

// A crosschecks object with one key, one role, and whatever values are handed
// in. Built by hand because the fixtures below are about the COMPARISON rule,
// not about how a document gets read.
const saidBy = (key, ...values) => ({
  [key]: { roles: { atq: { state: 'speaks', values: values.map(v => ({ value: v })) } } },
});

// Agreement is judged by the SAME rules as the row beside it: the key's own
// normaliser, and for a FUZZY_DIFF_KEYS name the tokenJaccard allowance on top.
eq('the subject repeating what the documents said agrees',
  stub.subjectVerdict(base.crosschecks, 'customerName', 'ABC Company Ltd'), 'agrees');
eq('a name none of them said is a disagreement',
  stub.subjectVerdict(base.crosschecks, 'customerName', 'Zenith Holdings Group'), 'differs');

// The fuzzy branch specifically. normName is aggressive enough that Ltd vs
// Limited normalises to one string and never reaches tokenJaccard -- so a
// fixture that only tried those would pass with the allowance deleted. This
// pair normalises to two DIFFERENT strings that score exactly at the
// DIFF_JACCARD_MIN threshold, which is the only shape that tests the branch.
{
  const said = 'Pacific Rim Data Systems Asia Limited';
  const heard = 'Pacific Rim Data Systems Limited';
  ok('the fixture really does need the fuzzy allowance -- it is not an exact match',
    stub.normName(said) !== stub.normName(heard) &&
    stub.tokenJaccard(stub.normName(said), stub.normName(heard)) >= stub.DIFF_JACCARD_MIN,
    { said: stub.normName(said), heard: stub.normName(heard),
      jaccard: stub.tokenJaccard(stub.normName(said), stub.normName(heard)) });
  eq('...and a near-enough name agrees, exactly as the cross-check would grade it',
    stub.subjectVerdict(saidBy('vendor', said), 'vendor', heard), 'agrees');
  eq('a name that is not near enough still differs',
    stub.subjectVerdict(saidBy('vendor', said), 'vendor', 'Northwind Cabling Works'), 'differs');
}

// An amount is not a name: a figure that normalises differently is a different
// figure, and the fuzzy allowance must not reach it.
eq('a different amount is a disagreement, with no fuzzy reprieve',
  stub.subjectVerdict(saidBy('hkd', '128,400.00'), 'hkd', '128,401.00'), 'differs');

// Silence is not disagreement -- the same rule quietRole applies to a role that
// never mentioned a field. All three ways it can happen.
eq('a subject that says nothing for the row is silent, not wrong',
  stub.subjectVerdict(base.crosschecks, 'customerName', ''), '');
eq('a row the crosscheck knows but no role spoke for is silent too',
  stub.subjectVerdict({ vendor: { roles: {} } }, 'vendor', 'Nice Systems BV'), '');
eq('...and so is a role that is present but says nothing',
  stub.subjectVerdict({ vendor: { roles: { atq: { state: 'silent', values: [] } } } },
    'vendor', 'Nice Systems BV'), '');
eq('a row no document reported at all is silent, however loud the subject is',
  stub.subjectVerdict(base.crosschecks, 'uid', 'UID-20-02-0002-10'), '');
eq('a key with no crosscheck at all does not throw',
  stub.subjectVerdict({}, 'vendor', 'Nice Systems BV'), '');
eq('nor does a null crosschecks object', stub.subjectVerdict(null, 'vendor', 'X Ltd'), '');

// Agreement with ANY document is agreement, and this is the fixture that says
// so. It is the real case: on one measured email the Cost worksheet's per-item
// "Vendor / Distributor" and the ATQ sheet's container-level "Vendor" contradict
// each other, and the email subject sides with the Cost worksheet. Requiring
// every document to agree would mark the email a stranger on the strength of
// the row it is helping to settle.
//
// Which files disagree AMONG THEMSELVES is the row's own job -- it is already
// amber. Colouring this column too would report one disagreement as two.
{
  const split = saidBy('vendor', 'Nice Systems BV', 'Ingram,Tech Data,AEM');
  eq('siding with one document while they argue is agreement, not dissent',
    stub.subjectVerdict(split, 'vendor', 'Nice Systems BV'), 'agrees');
  eq('...and siding with the other one is too',
    stub.subjectVerdict(split, 'vendor', 'Tech Data'), 'agrees');
  eq('...but agreeing with neither is still a disagreement',
    stub.subjectVerdict(split, 'vendor', 'Northwind Cabling Works'), 'differs');
}

// A document that collapsed a whole column into one cell -- the ATQ's PDF print
// does exactly this with the workbook's per-item Vendor column. The subject
// names one item's vendor, so it IS in there, and calling that a disagreement
// would flag the one email that got it right.
{
  const collapsed = { vendor: { roles: { atq: { state: 'speaks',
    values: [{ value: 'Ingram,Tech Data,Nice Systems BV' }] } } } };
  eq('a vendor listed among a collapsed column agrees',
    stub.subjectVerdict(collapsed, 'vendor', 'Nice Systems BV'), 'agrees');
  eq('...and one that is not still differs',
    stub.subjectVerdict(collapsed, 'vendor', 'Xtreme Lighting Limited'), 'differs');
}

/* ---------- which item the email is about ---------- */

// Procurement sends ONE email per item, so this is the subject's real
// authority: not to fill a value, but to decide whose values are on screen.
{
  const recs = n => n.map(v => ({ fields: [{ label: 'Item No.', value: v }] }));
  eq('the tab that opens is the item the subject names',
    stub.itemIndexForSubject(recs(['2', '4', '10']), { itemNo: '10' }), 2);
  eq('the first item is not special -- it is just item 0 when it matches',
    stub.itemIndexForSubject(recs(['2', '4', '10']), { itemNo: '2' }), 0);
  // A workbook can hand the same cell back as "10" or "10.0".
  eq('a numeric item number matches its decimal spelling',
    stub.itemIndexForSubject(recs(['2.0', '10.0']), { itemNo: '10' }), 1);
  // Landing on the WRONG item is worse than landing on the first: every value
  // then belongs to something nobody asked about, and nothing says so.
  eq('an item number no record carries falls back to the first, not to a near miss',
    stub.itemIndexForSubject(recs(['2', '4']), { itemNo: '10' }), 0);
  eq('a subject with no item marker leaves the choice alone',
    stub.itemIndexForSubject(recs(['2', '4']), { itemNo: '' }), 0);
  eq('no subject at all -- a non-email upload -- leaves it alone too',
    stub.itemIndexForSubject(recs(['2', '4']), null), 0);
  eq('no records is 0, not -1', stub.itemIndexForSubject([], { itemNo: '10' }), 0);
  eq('no record list at all is 0 too', stub.itemIndexForSubject(null, { itemNo: '10' }), 0);
  eq('a record with no item number of its own is not a match',
    stub.itemIndexForSubject([{ fields: [] }, ...recs(['10'])], { itemNo: '10' }), 1);
}

/* ---------- the reference strip: three rows no column can answer ---------- */

// ATQ Ref. No. / UID # / Record ID are not per-document. ATQ Ref. No. is the
// ATQ workbook's own reference, the UID is stated by the email, and the
// Record_ID is derived from the ATQ's reference and the item number. None of
// the three is a thing a document "disagrees" about, so each draws in the
// reference strip above the table, not as a comparison row.
//
// `uid` used to be an ordinary cross-check row and printed "not extracted" four
// times on every upload ever made -- no document reports a UID as a labelled
// field, so nothing was ever asked. Four blanks read as four documents having
// been asked and none knowing.
{
  const withValues = renders('ExtractedFieldsPage renders with an email and a record id',
    React.createElement(app.ExtractedFieldsPage, Object.assign({}, pageProps, {
      uid: 'UID-20-02-0002-10',
      recordId: 'ATQ-000000-00000-V01-10',
    })));
  ok('the UID is drawn', withValues.includes('UID-20-02-0002-10'), withValues.slice(0, 200));
  ok('the Record ID is drawn', withValues.includes('ATQ-000000-00000-V01-10'));
  // The strip is above the legend and the field table -- a reviewer reads it
  // first, per the redesign that pulled it out of the row list entirely.
  ok('the reference strip renders before the legend',
    withValues.indexOf(stub.SPANNING_ROWS.recordId.label) < withValues.indexOf('Agrees across documents'));
  ok('each says where it came from -- the email',
    withValues.includes(stub.SPANNING_ROWS.uid.from));
  ok('...and the rule the id follows',
    withValues.includes('ATQ Ref. No. + Item No.'));
  // The table is two columns now (Field, Value), so a spanning row's value
  // cell needs no colSpan at all -- it already is the whole remaining row.
  ok('a spanning row needs no colSpan -- there is only one column left to fill',
    !/cols?pan=/i.test(withValues), withValues.match(/cols?pan="\d+"/gi));

  // Absent is a real state and has to look different from a value, but the
  // provenance line stays either way: "the subject named no UID" and "no email
  // was uploaded at all" are indistinguishable without it.
  ok('with no email, the UID row says so rather than going blank',
    html.includes('not extracted'));
  ok('...and still says where it would have come from',
    html.includes(stub.SPANNING_ROWS.uid.from));
}

/* ---------- the email column is no longer rendered ---------- */

// The redesign dropped the email-subject witness column from the table
// itself (the user asked for Field + one Value column, nothing else) --
// EXTRACTED_EMAIL_COLUMN, SUBJECT_ROW_READERS and subjectVerdict stay as
// pure functions (tested above, on their own) with no live caller on this
// page any more.
{
  const withSubject = renders('ExtractedFieldsPage ignores emailSubject in its render',
    React.createElement(app.ExtractedFieldsPage, Object.assign({}, pageProps, {
      emailSubject: {
        customerName: 'ABC Company Ltd', vendor: 'Zenith Holdings Group',
        productType: 'Logger', backToBack: 'N',
      },
    })));
  ok('the email column heading is gone', !withSubject.includes(stub.EXTRACTED_EMAIL_COLUMN.label));
  // "Zenith Holdings Group" was the subject's own reading of vendor, and
  // nothing else on the demo fixture says it -- if it shows up, the witness
  // column is still drawing somewhere.
  ok('the subject\'s own words are not drawn anywhere on the page',
    !withSubject.includes('Zenith Holdings Group'));
  ok('a render with emailSubject and one without produce the same table',
    withSubject === html);
}

// Company Chop is the agreement's own ink, not a cross-checked field, so it
// stays scoped to that one column.
ok('the Company Chop row is drawn', html.includes('Company Chop'));
ok('the split n8n chop rows are not used',
  !html.includes('Chop Result') && !html.includes('Chop attachment'));
ok('demo carries no signing data, so the chop cell falls back to the placeholder',
  stub.signatureDetectionLabel(null) === '');

// The weaker answer: a result that knows a chop was found but kept no marks
// (demo data, an older parse). The one-line summary is what is left, and it is
// still worth saying.
const summaryOnly = demoClone(app);
summaryOnly.Contract.docs[0].signing = { hasSignature: true, hasChop: true, checked: true };
const summaryPipe = pipeline(summaryOnly);
const summaryHtml = renders('ExtractedFieldsPage renders a marks-less signing summary',
  React.createElement(app.ExtractedFieldsPage, Object.assign({}, pageProps,
    { attachments: summaryOnly, crosschecks: summaryPipe.crosschecks, census: summaryPipe.census })));
ok('a signing result with no marks falls back to the one-line summary',
  summaryHtml.includes('Signed &amp; Chopped'));

/* ---------- the detected chops themselves ---------- */

const chopped = demoClone(app);
chopped.Contract.docs[0].signing = JSON.parse(JSON.stringify(SIGNED_SIGNING));
// The demo ships every doc with `blob: null`; the View link is only offered
// when there are bytes to open, so the link case needs one.
chopped.Contract.docs[0].blob = { sentinel: 'agreement.pdf' };
const choppedPipe = pipeline(chopped);
const opened = [];
const choppedHtml = renders('ExtractedFieldsPage renders detected chops',
  React.createElement(app.ExtractedFieldsPage, Object.assign({}, pageProps,
    { attachments: chopped, crosschecks: choppedPipe.crosschecks, census: choppedPipe.census,
      openViewer: (typeKey, docIndex, page) => opened.push([typeKey, docIndex, page]) })));

ok('the counterparty behind the chop is named',
  choppedHtml.includes('Hospital Authority - TWGHS, Int&#x27;l Funeral Parlour'));
ok('our own chop stays on screen rather than being filtered out',
  choppedHtml.includes('Hong Kong Telecommunications (HKT) Limited'));
ok('and is marked as ours rather than read as a second counterparty',
  choppedHtml.includes('HKT&#x27;s own chop'));
ok('greyed, not coloured like the counterparty\'s',
  choppedHtml.includes('text-[#6B6B6B]"'));
ok('the page the chop was found on is stated', choppedHtml.includes('page 1'));
ok('so is the detector\'s own confidence', choppedHtml.includes('82% confidence'));
ok('and the ink colour it saw', choppedHtml.includes('red ink'));
ok('the sign-off block the name came from is kept as provenance',
  choppedHtml.includes('For and on behalf of'));
ok('the signature on the same page is reported too, not dropped with the summary',
  choppedHtml.includes('Signature also found'));
// The summary sentence is no longer the answer once there are marks to show.
ok('the one-line summary gives way to the detections', !choppedHtml.includes('Signed &amp; Chopped'));

ok('each chop offers a link to open the document at its own page',
  (choppedHtml.match(/View →/g) || []).length === 2,
  (choppedHtml.match(/View →/g) || []).length);

/* ---------- what the link actually opens ---------- */

// renderToStaticMarkup drops every handler, so the button is reached through
// the STUB React instead: its createElement returns plain {type, props,
// children} objects, and ExtractedFieldsPage uses no hooks, so calling it as a
// function hands back a tree the onClick can be pulled out of and invoked. The
// alternative -- asserting against a handler this test built itself -- would
// pass no matter what the page wires up.
function walk(node, hit) {
  if (Array.isArray(node)) { node.forEach(n => walk(n, hit)); return; }
  if (!node || typeof node !== 'object') return;
  hit(node);
  walk(node.children, hit);
  if (node.props && node.props.children) walk(node.props.children, hit);
}
function textOf(node) {
  const out = [];
  const collect = (x) => {
    if (typeof x === 'string' || typeof x === 'number') { out.push(String(x)); return; }
    if (Array.isArray(x)) { x.forEach(collect); return; }
    if (x && typeof x === 'object') { collect(x.children); if (x.props) collect(x.props.children); }
  };
  collect(node);
  return out.join(' ');
}

const agreementSlot = choppedPipe.census.assigned.agreement.doc;
const detectedChops = stub.markDetections(SIGNED_SIGNING, 'chop');
const stubTree = stub.ExtractedFieldsPage(Object.assign({}, pageProps,
  { attachments: chopped, crosschecks: choppedPipe.crosschecks, census: choppedPipe.census,
    openViewer: (typeKey, docIndex, page) => opened.push([typeKey, docIndex, page]) }));

const links = [];
walk(stubTree, n => {
  // `View →` with its arrow, not a bare /View/: the page also carries a
  // "Document Viewer" button, and "Viewer" contains "View". A loose match
  // counted that button as a chop link and shifted every assertion below by
  // one, which reads as "the chop links are wrong" rather than "the matcher
  // caught something else".
  if (n.props && n.props.onClick && /View\s*→/.test(textOf(n))) links.push(n);
});
eq('one link per detected chop', links.length, detectedChops.length);

opened.length = 0;
links.forEach(l => l.props.onClick());
eq('every link opens the agreement, not whatever tab is active',
  opened.map(o => o[0]).join(','), detectedChops.map(() => agreementSlot.typeKey).join(','));
eq('at the document the Agreement slot resolved to',
  opened.map(o => o[1]).join(','), detectedChops.map(() => agreementSlot.docIndex).join(','));
eq('and each at the page its own chop was found on',
  opened.map(o => o[2]).join(','), detectedChops.map(c => c.page).join(','));

// A document with signing but no bytes: everything is still described, and the
// link that would open an empty preview is not offered.
const noBytes = demoClone(app);
noBytes.Contract.docs[0].signing = JSON.parse(JSON.stringify(SIGNED_SIGNING));
const noBytesPipe = pipeline(noBytes);
const noBytesHtml = renders('ExtractedFieldsPage renders detected chops with no file behind them',
  React.createElement(app.ExtractedFieldsPage, Object.assign({}, pageProps,
    { attachments: noBytes, crosschecks: noBytesPipe.crosschecks, census: noBytesPipe.census,
      openViewer: () => {} })));
ok('a blob-less document still names its chops',
  noBytesHtml.includes('Hospital Authority - TWGHS, Int&#x27;l Funeral Parlour'));
ok('but offers no link to a preview it cannot show', !noBytesHtml.includes('View →'));

// A chop whose owner the engine could not read. The row says so out loud --
// the alternative a reviewer would misread is a blank cell, which looks like
// "no chop".
const anon = demoClone(app);
anon.Contract.docs[0].signing = { inspected: 1, hasSignature: false, hasChop: true,
  marks: [{ kind: 'chop', page: 2, confidence: 0.41 }] };
anon.Contract.docs[0].blob = { sentinel: 'agreement.pdf' };
const anonPipe = pipeline(anon);
const anonProps = Object.assign({}, pageProps,
  { attachments: anon, crosschecks: anonPipe.crosschecks, census: anonPipe.census });
const anonHtml = renders('ExtractedFieldsPage renders an unowned chop',
  React.createElement(app.ExtractedFieldsPage, anonProps));
ok('an unreadable sign-off block is reported, not left blank',
  anonHtml.includes('Owner not identified'));
ok('and the chop is still placed on its page', anonHtml.includes('page 2'));

// The page is the reason the link takes one at all: a chop on page 2 of an
// agreement opened at page 1 is exactly as hard to find as no link.
const anonOpened = [];
const anonLinks = [];
walk(stub.ExtractedFieldsPage(Object.assign({}, anonProps,
  { openViewer: (t, d, p) => anonOpened.push([t, d, p]) })),
  // Same `View →` matcher as above, and for the same reason: "Document
  // Viewer" is not a chop link.
  n => { if (n.props && n.props.onClick && /View\s*→/.test(textOf(n))) anonLinks.push(n); });
eq('one chop, one link', anonLinks.length, 1);
anonLinks.forEach(l => l.props.onClick());
eq('and it opens the page the chop is on, not the first page',
  anonOpened.length && anonOpened[0][2], 2);

/* ---------- a real disagreement changes the cells, not the shape ---------- */

const broken = setDemoField(demoClone(app), 'Contract', 'Customer Name', 'XYZ Holdings Ltd');
const bad = pipeline(broken);
eq('the contradicting document\'s own column reports what it says',
  stub.roleCellValue(bad.crosschecks, 'customerName', 'agreement'), 'XYZ Holdings Ltd');
eq('and the rest keep theirs',
  stub.roleCellValue(bad.crosschecks, 'customerName', 'atq', 'excel'), 'ABC Company Ltd');

const badHtml = renders('ExtractedFieldsPage renders a disagreement',
  React.createElement(app.ExtractedFieldsPage, Object.assign({}, pageProps,
    { attachments: broken, crosschecks: bad.crosschecks, census: bad.census })));
// The ATQ (Excel) reading leads the row, in the loud "different" tone -- and
// the Agreement's own contradicting value is not just implied by a tooltip
// any more, it is in the row's breakdown panel, one click away.
ok('the ATQ reading is drawn', badHtml.includes('ABC Company Ltd'));
ok('the row is coloured as a real conflict',
  badHtml.includes('text-[#C23934] font-bold') && badHtml.includes('bg-[#FDEBE9]'));
ok('the tooltip names the role that disagrees',
  badHtml.includes(stub.crosscheckSentence(bad.crosschecks.customerName)));
ok('...and the Agreement\'s own contradicting value is there to see, in the breakdown panel',
  badHtml.includes('XYZ Holdings Ltd'));

// "ATQ (Excel)" legitimately appears elsewhere on the page -- the column
// header, the page description, and crosscheckSentence's own tooltips, which
// name every role that spoke including the ATQ. What must never appear is
// "ATQ (Excel)" as one of the breakdown panel's OWN rows: that would repeat
// the row's own value back at itself as if it were a second witness.
ok('the breakdown panel never lists "ATQ (Excel)" as one of its own rows -- it is already the row\'s value',
  !/>ATQ \(Excel\)<\/td>/.test(badHtml), badHtml);

/* ---------- comparing is mandatory: a flagged row starts open, and a resolved one can be passed ---------- */

// The 5-column Verify Table now shows the breakdown (Agreement/Quotation
// comparison) always visible in the Cross Check column. The "open" concept
// has been replaced by the column being part of the table structure -- the
// flagged row's cross-check content is always visible.
ok('a flagged row\'s breakdown is always visible in the Cross Check column',
  /Cross Check<\/th>/.test(badHtml) && badHtml.includes('XYZ Holdings Ltd'));

{
  const passing = [];
  const toggleDismissDiff = k => passing.push(k);
  // The stub React tree, not renderToStaticMarkup: onClick handlers survive
  // there, so the Pass button can actually be invoked (same pattern as the
  // chop "View ->" link test above). This fixture has more than one flagged
  // row (the demo's own hkd/vendor conflicts are still present alongside the
  // customerName one just introduced), so this checks that A Pass button
  // dismisses customerName's own key, not that there is only one on the page.
  const tree = stub.ExtractedFieldsPage(Object.assign({}, pageProps,
    { attachments: broken, crosschecks: bad.crosschecks, census: bad.census, toggleDismissDiff }));
  const passButtons = [];
  walk(tree, n => { if (n.props && n.props.onClick && /^Pass$/.test(textOf(n).trim())) passButtons.push(n); });
  ok('every flagged row offers its own Pass button', passButtons.length >= 1, passButtons.map(textOf));
  passButtons.forEach(b => b.props.onClick());
  ok('clicking Pass dismisses the SAME key Verify\'s Automatic Checks would use',
    passing.indexOf(bad.crosschecks.customerName.dismissKey) >= 0, passing);
}

// Once passed -- dismissedDiffs carries the row's dismissKey -- the Value cell
// shows a quiet resolved state with the value still visible, an undo, and the
// Cross Check column continues to show the breakdown.
{
  const dismissedDiffs = new Set([bad.crosschecks.customerName.dismissKey]);
  const passedHtml = renders('ExtractedFieldsPage renders a passed row',
    React.createElement(app.ExtractedFieldsPage, Object.assign({}, pageProps,
      { attachments: broken, crosschecks: bad.crosschecks, census: bad.census, dismissedDiffs })));
  const passedIdx = passedHtml.indexOf('Customer Name');
  const passedCell = passedHtml.slice(passedIdx, passedIdx + 700);
  ok('a passed row has no <details>',
    !passedCell.includes('<details'));
  ok('...and says "Passed"', passedCell.includes('Passed'));
  ok('...the value stays visible, so passing never reads as deleting it',
    passedCell.includes('ABC Company Ltd'));
  ok('...and offers an undo back to the open comparison',
    passedCell.includes('undo'));
  ok('a passed row is no longer coloured as a conflict',
    !passedCell.includes('bg-[#FDEBE9]'));
}

/* ---------- a must-compare field with no value of its own is a problem too ---------- */

{
  // Agreement Number only compares against the Agreement (FIELD_ROW_CONFIG).
  // Blank the ATQ workbook's own reading but leave the Agreement's -- the row
  // has nothing to show as ITS value, but the comparison is still mandatory,
  // and the Agreement's own reading is sitting right there to check.
  const noExcelContract = setDemoField(demoClone(app), 'Excel', 'Agreement Number', '');
  const ncPipe = pipeline(noExcelContract);
  eq('the ATQ workbook has no contract number in this fixture',
    stub.roleCellValue(ncPipe.crosschecks, 'contractNo', 'atq', 'excel'), '');
  eq('...but the Agreement still does',
    stub.roleCellValue(ncPipe.crosschecks, 'contractNo', 'agreement'), 'AG-2026-004821');
  const ncHtml = renders('ExtractedFieldsPage renders a must-compare field with no value of its own',
    React.createElement(app.ExtractedFieldsPage, Object.assign({}, pageProps,
      { attachments: noExcelContract, crosschecks: ncPipe.crosschecks, census: ncPipe.census })));
  ok('the row reaches the page at all', ncHtml.includes(stub.FIELD_LABELS.contractNo), stub.FIELD_LABELS.contractNo);
  ok('the missing value is called out, not left to read as ordinary silence',
    ncHtml.includes('No value to compare'));
  ok('...in the loud missing-value colour', ncHtml.includes('bg-[#FDEBE9]') && ncHtml.includes('text-[#B23B3B]'));
  // In the 5-column layout the missing-value banner sits in the Cross Check
  // column, and the breakdown is always visible. Check that the banner is
  // present near the field label, and that the breakdown still offers the
  // Agreement's reading.
  {
    const labelIdx = ncHtml.indexOf('>' + stub.FIELD_LABELS.contractNo + '<');
    const bannerIdx = ncHtml.indexOf('No value to compare', labelIdx);
    ok('the "No value to compare" banner is in the Cross Check column near the row',
      labelIdx >= 0 && bannerIdx > labelIdx && bannerIdx - labelIdx < 600);
  }
  ok('...and the Agreement\'s own reading is offered, so the reviewer can check it',
    ncHtml.includes('AG-2026-004821'));
}

/* ---------- solo rows: Product Type / Service Type / Back-to-Back, and the Quotation No. fallback ---------- */

{
  // Product Type / Service Type / Back-to-Back never come from anywhere but
  // the ATQ workbook, so a value on that document alone must render plainly
  // -- no colour, no breakdown -- even though the same keys stay in DIFF_KEYS
  // for other consumers (Verify's own Automatic Checks).
  const solo = demoClone(app);
  solo.Excel.docs[0].fields.push(
    { label: 'Product Type', value: 'UCBV AV Equipment' },
    { label: 'Service Type', value: 'Maintenance' },
    { label: 'Back-to-Back', value: 'N' });
  const soloPipe = pipeline(solo);
  const soloHtml = renders('ExtractedFieldsPage renders solo (single-document) fields',
    React.createElement(app.ExtractedFieldsPage, Object.assign({}, pageProps,
      { attachments: solo, crosschecks: soloPipe.crosschecks, census: soloPipe.census })));
  // Product Type is the exception among the three, and deliberately so:
  // FEATURES.verifyAtqExcelDataverseOnly (dev side) makes its Value the
  // BTB_ATQ_Excel column `new_product_type` and NOTHING else, so a workbook
  // reading with no Dataverse record behind it is not shown. IPT Unit Mgr is
  // the same row a second time. Asserting the absence as well as the presence
  // below, because "the workbook value is suppressed" and "the row renders
  // nothing at all" look identical from the presence check alone.
  ok('Product Type\'s workbook reading is NOT drawn -- the ATQ Excel column is the value',
    !soloHtml.includes('UCBV AV Equipment'));
  ok('...and the row is still on the page, reading "not extracted"',
    /Product Type[\s\S]{0,400}not extracted/.test(soloHtml));
  {
    const soloDvHtml = renders('ExtractedFieldsPage renders Product Type from the ATQ Excel record',
      React.createElement(app.ExtractedFieldsPage, Object.assign({}, pageProps,
        { attachments: solo, crosschecks: soloPipe.crosschecks, census: soloPipe.census,
          recordId: 'ATQ-000000-00000-V01-1',
          dataverseVerify: { source: 'n8n', recordId: 'ATQ-000000-00000-V01-1', status: 'ready',
            agreement: null, quotation: null, lis: null,
            atqExcel: { productType: 'DV Product Type', iptUnitMgr: 'DV Unit Mgr' } } })));
    ok('the ATQ Excel column\'s Product Type is what shows',
      soloDvHtml.includes('DV Product Type') && !soloDvHtml.includes('UCBV AV Equipment'));
    ok('...and IPT Unit Mgr reads the same record',
      soloDvHtml.includes('DV Unit Mgr'));

    // The bug this pins (2026-09-25): IPT Unit Mgr is `solo`, so its Value and
    // Cross Check cells are both empty and the LIS Value BOX is the only thing
    // on screen. lisValueForRow seeded that box from BTB_LIS_Excel_Datas first,
    // so a LIS row already holding admin_iptx0020unitx0020mgr beat the
    // admin_iptunitmanager2 reading that atqExcelDataverseOnly had just made
    // the only Value. `lisSeedPrefersValue` flips those two tiers for this row.
    //
    // Asserting the ABSENCE of the LIS value as well as the presence of the ATQ
    // Excel one: "the ATQ Excel value wins" and "both are somewhere on the
    // page" are not the same claim, and only the first is the fix.
    const withLis = { source: 'n8n', recordId: 'ATQ-000000-00000-V01-1', status: 'ready',
      agreement: null, quotation: null,
      lis: { iptUnitMgr: 'LIS Unit Mgr', handledBy: 'LIS Handler' },
      atqExcel: { productType: 'DV Product Type', iptUnitMgr: 'DV Unit Mgr' } };
    const lisHtml = renders('ExtractedFieldsPage renders with a competing LIS reading',
      React.createElement(app.ExtractedFieldsPage, Object.assign({}, pageProps,
        { attachments: solo, crosschecks: soloPipe.crosschecks, census: soloPipe.census,
          recordId: 'ATQ-000000-00000-V01-1', dataverseVerify: withLis })));
    ok('IPT Unit Mgr prefers the ATQ Excel column over the LIS reading',
      lisHtml.includes('DV Unit Mgr'));
    ok('...and the LIS reading is NOT what the box shows',
      !lisHtml.includes('LIS Unit Mgr'));
    // The flag is per row and must not leak. Handled By is an ordinary row and
    // keeps the LIS-first seed it has always had.
    ok('a row without the flag still seeds from LIS first',
      lisHtml.includes('LIS Handler'));
  }
  ok('Service Type\'s value is drawn', soloHtml.includes('Maintenance'));
  ok('Back-to-Back\'s value is drawn', /Back-to-Back[\s\S]{0,300}>N</.test(soloHtml), soloHtml.indexOf('Back-to-Back'));
  ['Product Type', 'Service Type', 'Back-to-Back'].forEach(label => {
    ok(`${label} is not coloured as a conflict`,
      !new RegExp(label + '[\\s\\S]{0,300}(text-\\[#C23934\\]|text-\\[#8A5A12\\]|bg-\\[#FDEBE9\\]|bg-\\[#FBEEDB\\])').test(soloHtml));
    ok(`${label} offers no breakdown to expand`,
      !new RegExp(label + '[\\s\\S]{0,300}<details').test(soloHtml));
  });

  // Quotation No.: the ATQ workbook usually has its own reading, and the row
  // compares it against the Quotation document (FIELD_ROW_CONFIG above). When
  // the workbook leaves it blank -- a real, measured shape, see CLAUDE.md's
  // note on ATQ-202603-00386-V23 -- the row falls back to the Quotation
  // document's own value, plainly, with no flag and no breakdown.
  const noExcelQuotation = setDemoField(demoClone(app), 'Excel', 'Quotation', '');
  const fbPipe = pipeline(noExcelQuotation);
  eq('the ATQ workbook really has no quotation reference in this fixture',
    stub.roleCellValue(fbPipe.crosschecks, 'quotation', 'atq', 'excel'), '');
  const fbHtml = renders('ExtractedFieldsPage falls back to the Quotation document for Quotation No.',
    React.createElement(app.ExtractedFieldsPage, Object.assign({}, pageProps,
      { attachments: noExcelQuotation, crosschecks: fbPipe.crosschecks, census: fbPipe.census })));
  ok('the Quotation document\'s own reference is shown', fbHtml.includes('QT-2600008'));
  ok('...plainly -- no conflict colour, since nothing was compared',
    !/QT-2600008[\s\S]{0,80}(text-\[#C23934\]|text-\[#8A5A12\])/.test(fbHtml) &&
    !/(text-\[#C23934\]|text-\[#8A5A12\])[\s\S]{0,80}QT-2600008/.test(fbHtml));
  ok('...and no breakdown, since there is only the one document to show',
    !/QT-2600008[\s\S]{0,50}<\/summary>/.test(fbHtml));
}

/* ---------- a multi-item upload gets an item strip ---------- */

const twoItems = demoClone(app);
twoItems.ATQ.records = [
  { fields: [{ label: 'Item No.', value: '2' }, { label: 'Quotation', value: 'QT-2600008' }] },
  { fields: [{ label: 'Item No.', value: '3' }, { label: 'Quotation', value: 'Q2026050009R' }] },
];
const twoPipe = pipeline(twoItems);
const twoHtml = renders('ExtractedFieldsPage renders a multi-item upload',
  React.createElement(app.ExtractedFieldsPage, Object.assign({}, pageProps,
    { attachments: twoItems, crosschecks: twoPipe.crosschecks, census: twoPipe.census })));
// The Verify Table only ever shows the item selected in Upload & Parse --
// no tabs to switch item on this page, since it is a read-only preview of
// whichever item Process/Send to n8n already committed to.
ok('shows which item is on screen, with no tab to switch it',
  twoHtml.includes('Item 1 of 2') && !twoHtml.includes('Item 2</span>'));
ok('a single-item upload shows no item strip at all', !html.includes('Item 1 of'));

/* ---------- the chop's own picture ---------- */

// A reviewer asking about a company chop wants to see one 2cm ring, and the
// answer to "whose is it" is never in the ink -- readChopText returned "0",
// null, "One Center" and "lons (HK1) Limited 6" across the four documents in
// Demo Data/chop/. So the engine cuts the mark AND the printed sign-off block
// above it (markCropRect, pinned geometrically in chop-owner.test.js) and the
// row shows that instead of making the reviewer open the document.
//
// The data URLs here are 1x1 GIFs: what is being pinned is that the crop
// travels from mark to row to <img>, not what it looks like.
const PIX = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
const PIX2 = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICRAEAOw==';

{
  const cropped = stub.markDetections({ marks: [
    Object.assign({ crop: PIX }, SIGNED_MARKS[0]),
    Object.assign({ crop: PIX2 }, SIGNED_MARKS[1]),
  ] }, 'chop');
  eq('the crop travels with the mark', cropped[0].crop, PIX);
  eq('...one per mark, not shared', cropped[1].crop, PIX2);
  // A parse without markCrop, demo data, and a rect too small to draw all land
  // here. None of them is a reason to drop the line.
  eq('a mark with no crop reports "" rather than undefined', detected[0].crop, '');
  eq('...and still has everything else', detected[0].name,
    "Hospital Authority - TWGHS, Int'l Funeral Parlour");
  eq('an unowned chop with no crop is still listed', unnamed.length, 1);
}

{
  // The Company Chop row reads `signing` off whichever document holds the
  // AGREEMENT role, which the census resolves to Contract#0 on this fixture --
  // not off an attachment key called "Agreement", which does not exist.
  const signingWith = marks => ({ inspected: 1, pagesNotInspected: 0,
    signatureBlock: true, hasSignature: false, hasChop: true, marks: marks });
  const agreementDocOf = attachments => {
    const census = stub.roleCensus(attachments, null, stub.offItemQuotationTest(attachments, 0));
    const src = (census.docs || []).find(d => d.role === 'agreement');
    ok('the fixture has a document in the agreement role', !!src, (census.docs || []).map(d => d.role));
    const entry = attachments[src.typeKey];
    return src.docIndex >= 0 && entry.docs ? entry.docs[src.docIndex] : entry;
  };

  const withCrops = demoClone(app);
  agreementDocOf(withCrops).signing = signingWith([
    Object.assign({ crop: PIX }, SIGNED_MARKS[0]),
    Object.assign({ crop: PIX2 }, SIGNED_MARKS[1]),
  ]);

  const shown = renders('ExtractedFieldsPage renders chop crops',
    React.createElement(app.ExtractedFieldsPage,
      Object.assign({}, pageProps, { attachments: withCrops })));
  const srcs = (shown.match(/<img[^>]*src="(data:image\/gif[^"]*)"/g) || [])
    .map(t => (t.match(/src="([^"]*)"/) || [])[1]);
  const imgs = srcs.length;

  // If the fixture cannot reach the row, say so loudly rather than passing on
  // an empty page -- a render assertion that matches nothing is worse than red.
  ok('the fixture reaches the Company Chop row at all',
    shown.includes('Hospital Authority - TWGHS'), shown.length);
  ok('one picture per chop is drawn', imgs === 2, imgs);
  // Each row must show ITS OWN chop. Drawing the first mark's picture beside
  // every name is the failure this catches, and it looks entirely correct on a
  // page with one chop -- which most pages have.
  ok('...and they are different pictures, not the first one repeated',
    imgs === 2 && srcs[0] !== srcs[1], srcs);
  ok('the enlarge control says what it does',
    shown.includes('Enlarge this chop and the sign-off block above it'));
  ok('the picture carries an alt naming the page it came from',
    shown.includes('Company chop on page 1'));
  // This fixture's documents carry no blob, so the "View →" link into the
  // document is not offered at all -- and the crop is still there. That is the
  // point of cutting the mark out rather than linking to the page: the picture
  // does not depend on there being bytes to open.
  ok('the crop shows even where no document can be opened',
    !shown.includes('View →') && imgs === 2, { view: shown.includes('View →'), imgs });
  // The overlay is state-driven, and renderToStaticMarkup never clicks. What
  // can be pinned is that it starts closed -- an overlay rendered open would
  // cover the table on arrival.
  ok('the enlarged view starts closed', !shown.includes('aria-label="Company chop, enlarged"'));

  // Same page, marks with no crop: the row keeps every line and draws no
  // broken image.
  const noCrop = demoClone(app);
  agreementDocOf(noCrop).signing = signingWith(SIGNED_MARKS.slice(0, 2));
  const plain = renders('ExtractedFieldsPage renders chops with no crop',
    React.createElement(app.ExtractedFieldsPage,
      Object.assign({}, pageProps, { attachments: noCrop })));
  ok('a chop with no picture still names its owner',
    plain.includes('Hospital Authority - TWGHS'));
  ok('...and draws no empty <img>', !/<img[^>]*src=""/.test(plain));
}

/* ---------- the column header's document button ---------- */

// Each column header opens the ONE document its cells were read from. The
// resolution has to be roleCellValue's own, or the header offers a file that
// never reported the values under it -- which invites the reviewer to check a
// number against a document that does not contain it.
{
  const census = stub.roleCensus(demo, null, stub.offItemQuotationTest(demo, 0));
  const col = key => stub.EXTRACTED_FIELD_COLUMNS.find(c => c.key === key);
  const nameOf = c => {
    const s = stub.columnDocSource(census, c);
    return s ? s.fileName : null;
  };

  eq('Agreement opens the agreement', nameOf(col('agreement')), 'Contract-signed.pdf');
  eq('Quotation opens the quotation', nameOf(col('quotation')), 'VQ-2026-1847.pdf');
  // The index travels too, and it is what openViewer is actually handed --
  // a source resolved to the right FILE and the wrong index opens a sibling.
  eq('the agreement source carries its own tab', stub.columnDocSource(census, col('agreement')).typeKey, 'Contract');
  eq('...and its own index', stub.columnDocSource(census, col('agreement')).docIndex, 0);

  // The ATQ role holds TWO documents (the PDF print and the workbook behind
  // it) and this column is the WORKBOOK -- docRankFor now assigns the
  // workbook to the role by default too (the Cost worksheet is the document
  // of record, see atqCostRecordsForItem), but the column still does its own
  // kind-based re-pick rather than leaning on `assigned`, since a PDF-only
  // upload or a manual override could point the role elsewhere.
  eq('ATQ (Excel) opens the workbook',
    nameOf(col('atq-excel')), 'ATQ-202604-00177.xlsx');
  eq('...and the role\'s own default assignment is the workbook too',
    census.assigned.atq.doc.fileName, 'ATQ-202604-00177.xlsx');

  // The kind search must stay inside the column's OWN role. On the shipped demo
  // every other document happens to be a PDF, so dropping the role filter still
  // lands on the ATQ workbook by luck -- this fixture puts a non-PDF under
  // another role, ahead of it, which is the case that tells the two apart.
  eq('the kind search does not leave the column\'s role',
    stub.columnDocSource({ assigned: {}, docs: [
      { role: 'quotation', fileName: 'quote.xlsx' },
      { role: 'atq', fileName: 'ATQ-1.pdf' },
      { role: 'atq', fileName: 'ATQ-1.xlsx' },
    ] }, col('atq-excel')).fileName, 'ATQ-1.xlsx');

  // Nothing selected means no button rather than a dead one.
  eq('a role with nothing assigned resolves to nothing',
    stub.columnDocSource({ assigned: {}, docs: [] }, col('agreement')), null);
  eq('a kind column with no matching document resolves to nothing',
    stub.columnDocSource({ assigned: {}, docs: [{ role: 'atq', fileName: 'x.pdf' }] }, col('atq-excel')), null);
  eq('no census at all is null, not a throw', stub.columnDocSource(null, col('agreement')), null);
  eq('no column either', stub.columnDocSource(census, null), null);
}

{
  // The demo documents carry no blob (JSON fixtures cannot), and a viewer
  // opened on nothing shows an empty preview -- so the button is withheld.
  // That is the default state of the page and worth pinning on its own.
  const bare = renders('ExtractedFieldsPage renders with no openable documents',
    React.createElement(app.ExtractedFieldsPage,
      Object.assign({}, pageProps, { openViewer: () => {} })));
  ok('a document with no bytes behind it gets no header button',
    !bare.includes('the document this column is reading from'));

  // With bytes, the one remaining column gets its button, naming its file.
  const openable = demoClone(app);
  stub.ATTACHMENT_TYPES.forEach(k => {
    const e = openable[k];
    (e && e.docs || []).forEach(d => { d.blob = { size: 1 }; });
  });
  const withDocs = renders('ExtractedFieldsPage renders the header document button',
    React.createElement(app.ExtractedFieldsPage,
      Object.assign({}, pageProps, { attachments: openable, openViewer: () => {} })));
  const buttons = (withDocs.match(/Open [^"]*the document this column is reading from/g) || []);
  ok('exactly one button, for the one value column left', buttons.length === 1, buttons);
  ok('the ATQ (Excel) button names the WORKBOOK',
    buttons.some(b => b.indexOf('ATQ-202604-00177.xlsx') >= 0), buttons);
  ok('...and not the ATQ PDF, which the column does not read from',
    !buttons.some(b => b.indexOf('ATQ-202604-00177.pdf') >= 0), buttons);
  // The Agreement and Quotation documents no longer have a HEADER button --
  // there is no column of their own for one to belong to -- but the demo's
  // one flagged row (hkd) opens a breakdown panel that offers its own button
  // for each source, with its own, shorter title ("Open <file>", not "...the
  // document this column is reading from"), so the two kinds of button never
  // collide in the count above.
  ok('the Agreement gets a button from the flagged row\'s breakdown panel, not a header',
    withDocs.includes('Contract-signed.pdf') && !/Contract-signed\.pdf[^"]*the document this column is reading from/.test(withDocs));
  ok('the Quotation gets one too, the same way',
    withDocs.includes('VQ-2026-1847.pdf') && !/VQ-2026-1847\.pdf[^"]*the document this column is reading from/.test(withDocs));

  // No way to open anything: the page still renders, minus the buttons.
  const noViewer = renders('ExtractedFieldsPage renders without openViewer',
    React.createElement(app.ExtractedFieldsPage,
      Object.assign({}, pageProps, { attachments: openable })));
  ok('no openViewer means no header button',
    !noViewer.includes('the document this column is reading from'));
  ok('...nor a breakdown-panel button', !noViewer.includes('Contract-signed.pdf'));

  // Dataverse mode never applies to the ATQ column itself --
  // DATAVERSE_VERIFY_SOURCES has no "atq" entry -- so its header button and
  // tooltip are unchanged.
  const dv = renders('ExtractedFieldsPage renders the header button in Dataverse mode',
    React.createElement(app.ExtractedFieldsPage, Object.assign({}, pageProps, {
      attachments: openable, openViewer: () => {}, recordId: RID, dataverseVerify: live,
    })));
  ok('the ATQ column keeps its ordinary tooltip, since Dataverse does not answer for it',
    dv.indexOf('ATQ-202604-00177.xlsx — the document this column is reading from') >= 0, dv);
  ok('the breakdown panel no longer carries a DATAVERSE badge',
    !dv.includes('DATAVERSE'), dv);
}

/* ---------- Quotation Expire Date prefills its LIS Value box ---------- */

// The row carries `lisAutoFill`, and its Value (ATQ Excel) cell is
// deliberately blank: the ATQ workbook has no expiry column, so that cell
// reads "not extracted" by design and the Quotation is the only source there
// has ever been. Prefilling from the Value alone therefore filled the box with
// nothing -- an empty LIS box sitting beside a Cross Check plainly showing the
// date, which on screen is indistinguishable from "nothing was extracted".
//
// Dataverse mode is where this is reachable: quotationExpireDate is not in
// FIELD_LABEL_MAP at all, so no document label pass ever produces one -- the
// value comes from the Quotation Dataverse table.
{
  const expiryDv = ready({ quotation: { quotationExpireDate: '14-Oct-26' }, atqExcel: {} });
  const expiryProps = Object.assign({}, pageProps,
    { recordId: RID, dataverseVerify: expiryDv });
  const inputs = [];
  walk(stub.ExtractedFieldsPage(expiryProps), n => {
    if (n.props && n.props['aria-label'] === 'Quotation Expire Date LIS value') inputs.push(n);
  });
  eq('the Quotation Expire Date row has one LIS Value box', inputs.length, 1);
  eq('...prefilled with the Quotation reading rather than its own blank Value cell',
    inputs.length ? inputs[0].props.value : '(no box)', '14-Oct-26');

  // `lisOnly`: the row draws the box and nothing else. Its Value cell was a
  // permanent "not extracted" (the ATQ workbook has no expiry column) and its
  // Cross Check cell repeated the value the box now carries, so both were
  // taken out. Asserted on the ROW, not the page -- "not extracted" is a
  // perfectly ordinary thing for other rows to say.
  const expiryHtml = renders('ExtractedFieldsPage renders the lisOnly row',
    React.createElement(app.ExtractedFieldsPage, expiryProps));
  const at = expiryHtml.indexOf('Quotation Expire Date');
  const rowHtml = at < 0 ? '' : expiryHtml.slice(at, expiryHtml.indexOf('</tr>', at));
  ok('the Quotation Expire Date row is on the page', at >= 0);
  ok('...and still carries its LIS Value box',
    rowHtml.includes('Quotation Expire Date LIS value'), rowHtml);
  ok('...with no "not extracted" Value cell left beside it',
    !rowHtml.includes('not extracted'), rowHtml);
  ok('...and no Cross Check breakdown either',
    !rowHtml.includes('Cross Check') && !rowHtml.includes('Agrees'), rowHtml);

  // With its other two cells gone, the LIS column is the only place left that
  // can reach the document the value was read from -- so this one row's LIS
  // cell takes a document button. It is NOT a general re-adding of the Open
  // pill that was removed from this column on both sides: a uid/solo row's LIS
  // cell must still be a bare box.
  const openableQ = demoClone(app);
  stub.ATTACHMENT_TYPES.forEach(k => {
    const e = openableQ[k];
    (e && e.docs || []).forEach(d => { d.blob = { size: 1 }; });
  });
  const openablePipe = pipeline(openableQ);
  const withBtn = renders('ExtractedFieldsPage renders the lisOnly row with bytes behind it',
    React.createElement(app.ExtractedFieldsPage, Object.assign({}, expiryProps, {
      attachments: openableQ, crosschecks: openablePipe.crosschecks,
      census: openablePipe.census, openViewer: () => {},
    })));
  const rowOf = label => {
    const i = withBtn.indexOf(label);
    return i < 0 ? '' : withBtn.slice(i, withBtn.indexOf('</tr>', i));
  };
  const expiryRow = rowOf('Quotation Expire Date');
  ok('the lisOnly row offers a document button in its LIS cell',
    /title="Open [^"]+"/.test(expiryRow), expiryRow);
  ok('...and still has its box beside it',
    expiryRow.includes('Quotation Expire Date LIS value'), expiryRow);
  const handledByRow = rowOf('Handled By');
  ok("a solo row's LIS cell is still a bare box, with no Open pill",
    handledByRow !== '' && !/title="Open [^"]+"/.test(handledByRow), handledByRow);

}

// Quotation Expire Date: tomorrow warning & orange background
{
  const today = app.localIsoDay();
  const tomorrow = app.localIsoTomorrow();
  ok('localIsoTomorrow returns a valid date string', typeof tomorrow === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(tomorrow));
  const tToday = new Date(today);
  const tTomorrow = new Date(tomorrow);
  eq('localIsoTomorrow is exactly 1 day after localIsoDay',
    Math.round((tTomorrow.getTime() - tToday.getTime()) / 86400000), 1);

  // When quotation expiry is tomorrow
  const tomorrowDv = ready({ quotation: { quotationExpireDate: tomorrow }, atqExcel: {} });
  const tomorrowProps = Object.assign({}, pageProps, { recordId: RID, dataverseVerify: tomorrowDv });
  const tomorrowHtml = renders('ExtractedFieldsPage renders quotation expiring tomorrow',
    React.createElement(app.ExtractedFieldsPage, tomorrowProps));

  ok('the row has verify-row-warning class when expiring tomorrow',
    tomorrowHtml.includes('verify-row-warning'));
  ok('the LIS input has orange background and border styling',
    tomorrowHtml.includes('bg-[var(--orange)]') && tomorrowHtml.includes('border-[var(--orange-dark)]'));
  ok('the field cell displays "Urgent — expires tomorrow !!!"',
    tomorrowHtml.includes('Urgent — expires tomorrow !!!'));
  ok('the alarm note row reminds user quotation was expiry on Tomorrow',
    tomorrowHtml.includes('The quotation was expiry on Tomorrow, please process it Urgently.'));
  ok('the top banner warns about expiring tomorrow',
    tomorrowHtml.includes('Urgent !!! The quotation expires tomorrow.') &&
    tomorrowHtml.includes('The quotation was expiry on Tomorrow, please process it Urgently.'));
}

/* ---------- report ---------- */

console.log(passed + ' passed, ' + failures.length + ' failed');
if (failures.length) {
  failures.forEach(f => console.log('  FAIL  ' + f));
  process.exit(1);
}
