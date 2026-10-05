// What a vendor's own quotation contributes to the Extracted Fields table.
//
//   node _test/app-harness/quotation-fields.test.js
//
// Two independent failures made the Quotation column read "not extracted" for
// almost every row on a real HKDC upload, and this pins both:
//
//   1. Label vocabulary. A quotation says "Quotation No." / "Quote No.",
//      "Total Amount (HK$)" / "Sub-Total" and "On Behalf of"; FIELD_LABEL_MAP
//      only knew the ATQ's spellings ("Quotation", "Total Value of Quotation
//      (HKD)", "Vendor / Distributor"). Worse, "Quotation No." was reaching
//      contractNo through the fallback list, so the one value the quotation did
//      report landed in the wrong row.
//
//   2. Item scope. An ATQ covering "Item 2 & 3" carries one quotation per item
//      and records which is which (record.quotationFiles, set by the engine's
//      matchQuotationAttachments); nothing in the app read it, so both items
//      showed whichever quotation sorted first -- or a forwarded .mht that
//      merely had "quote" in its filename, whose "To:" header then filled
//      Customer Name with an email address.
//
// No corpus document is read here: the fixtures below are hand-written to the
// shape the engine actually returned for e4.eml (verified against it), so the
// test states the contract rather than depending on a file under _test/.

const { load } = require('./app.js');
const app = load();

let passed = 0;
const failures = [];

function ok(label, cond, detail) {
  if (cond) { passed++; return; }
  failures.push(label + (detail === undefined ? '' : '\n      got: ' + JSON.stringify(detail)));
}
function eq(label, actual, expected) {
  ok(label, actual === expected, { actual, expected });
}

/* ---------- 1. A quotation's own label vocabulary ---------- */

// Xtreme Lighting's quotation: labels and values do pair up on the page.
const XTREME_FIELDS = [
  { label: 'Attention', value: 'Mr. Ben Cheng' },
  { label: 'Quotation No', value: 'Q2026050009R' },
  { label: 'Client', value: 'HKT' },
  { label: 'Date', value: '14/07/2026' },
  { label: 'Email', value: 'kwan-chi.cheng@pccw.com' },
  { label: 'Total Amount (HK$)', value: '$4,000.0' },
  { label: 'Payment Terms', value: '100% upon completion' },
];

const xtreme = app.mapDetectedFields(XTREME_FIELDS, null);
eq('"Quotation No" is a quotation number', xtreme.quotation, 'Q2026050009R');
eq('...and no longer doubles as a contract number', xtreme.contractNo, undefined);
eq('"Total Amount (HK$)" is the amount', xtreme.hkd, '$4,000.0');
eq('"Client" still reads as the customer', xtreme.customerName, 'HKT');

eq('Contract No. keeps only the identifier before trailing address text',
  app.mapDetectedFields([
    { label: 'Contract No.', value: '42026WB213AC_V2 280 Tung Chau Street,' },
  ], null).contractNo, '42026WB213AC_V2');

// NEXUS2S's quotation: the header is two stacked blocks, so the engine pairs
// nothing there and the quotation number is only in the text.
const NEXUS_FIELDS = [
  { label: 'Title', value: 'HKDC - System Inspection' },
  { label: 'Quote Date', value: 'Expiry Date' },
  { label: '15-Jul-26', value: '14-Oct-26' },
  { label: 'Sub-Total', value: '4,000.00' },
  { label: 'On Behalf of', value: 'NEXUS2S Asia Limited' },
];
const NEXUS_TEXT = [
  '=== Attachment: QT-2600008_HKT_HKDC_System Inspection (1).pdf ===',
  '', 'NEXUS2S Asia Limited', 'Quote', '', 'HKT Limited', '',
  'Quote No.', 'Quote Date', 'Expiry Date', '',
  'QT-2600008', '15-Jul-26', '14-Oct-26', '',
  'Title:   HKDC - System Inspection',
].join('\n');

const nexusLabelsOnly = app.mapDetectedFields(NEXUS_FIELDS, null);
eq('"Sub-Total" is the amount', nexusLabelsOnly.hkd, '4,000.00');
eq('"On Behalf of" names the vendor', nexusLabelsOnly.vendor, 'NEXUS2S Asia Limited');
eq('labels alone cannot find the quotation number here', nexusLabelsOnly.quotation, undefined);

const nexus = app.mapDetectedFields(NEXUS_FIELDS, null, NEXUS_TEXT);
eq('...but the document\'s own text can', nexus.quotation, 'QT-2600008');
eq('the text pass never overrides a labelled value',
  app.mapDetectedFields(XTREME_FIELDS, null, NEXUS_TEXT).quotation, 'Q2026050009R');

// Dropped straight onto the Vendor Quotation tab, the per-tab allowlist applies.
const onTab = app.mapDetectedFields(XTREME_FIELDS, 'Vendor Quotation');
eq('a quotation dropped on its own tab can fill the form\'s Quotation field',
  onTab.quotation, 'Q2026050009R');
eq('...and the tab scope still keeps contractNo out of it', onTab.contractNo, undefined);

/* ---------- quotationRefFromText on its own ---------- */

eq('stacked label block over value block',
  app.quotationRefFromText(NEXUS_TEXT), 'QT-2600008');
eq('a label that does pair up on its own line',
  app.quotationRefFromText('Attention: Mr Ben\nQuotation No.: Q2026050009R\nDate: 14/07/2026'),
  'Q2026050009R');
eq('"Quote Ref" spelling', app.quotationRefFromText('Quote Ref\nQT-2600008'), 'QT-2600008');
eq('a document that never says so at all',
  app.quotationRefFromText('Maintenance Service Agreement\nBetween HKT and ABC Ltd'), null);
eq('the bare word "Quote" is a heading, not a labelled number',
  app.quotationRefFromText('Quote\n15-Jul-26'), null);
eq('a date is never mistaken for a reference',
  app.quotationRefFromText('Quote No.\nQuote Date\n15-Jul-26\n14-Oct-26'), null);
eq('no text at all', app.quotationRefFromText(''), null);

/* ---------- the sign-off guess ----------
   Xtreme Lighting's quotation labels nothing as a vendor: the two sign-off
   columns collapse into one line, so "For and on behalf of" pairs with the
   other column's boilerplate and the company is left standing on its own. */

const XTREME_SIGNOFF = [
  'Terms & Conditions',
  '4. Cheque payable to " Xtreme Lighting Limited"',
  '',
  'For and on behalf of   Accepted By: Sign/Stamp/Date',
  'Xtreme Lighting Limited',
  '',
  'Authorized Signature(s)   Signature & Company Chop',
].join('\n');

eq('the company under the sign-off is read as the vendor',
  app.vendorFromText(XTREME_SIGNOFF), 'Xtreme Lighting Limited');
eq('...and reaches mapDetectedFields when no label answered',
  app.mapDetectedFields(XTREME_FIELDS, null, XTREME_SIGNOFF).vendor, 'Xtreme Lighting Limited');
eq('a labelled vendor still wins over the guess',
  app.mapDetectedFields(XTREME_FIELDS.concat([{ label: 'Vendor / Distributor', value: 'Xtreme Lighting Ltd' }]),
    null, XTREME_SIGNOFF).vendor, 'Xtreme Lighting Ltd');
eq('the same line, when the document does pair them',
  app.vendorFromText('On behalf of: ACME Trading Company Limited\nAuthorized Signature'),
  'ACME Trading Company Limited');

// The guard that keeps this from answering on a contract: both parties sign
// one, and there is no way to tell which block is the vendor's.
const BILATERAL = [
  'SIGNED for and on behalf of',
  'Hong Kong Telecommunications (HKT) Limited',
  'Name:', 'Title:',
  'SIGNED for and on behalf of',
  'ABC Trading Limited',
  'Name:', 'Title:',
].join('\n');
eq('two sign-off blocks -> no guess at all', app.vendorFromText(BILATERAL), null);
eq('no sign-off block either', app.vendorFromText('Quotation No.: Q1\nTotal: 4,000'), null);
eq('a sign-off block with nothing but boilerplate under it',
  app.vendorFromText('For and on behalf of\nAuthorized Signature(s)\nSign/Stamp/Date\nName:\nTitle:'), null);
eq('no text at all', app.vendorFromText(''), null);

// What counts as a company name.
[['Xtreme Lighting Limited', true], ['NEXUS2S Asia Limited', true], ['Systec Engineering Limited', true],
 ['ACME Co', true], ['Authorized Signature(s)', false], ["Client's Signature & Chop", false],
 ['Sign/Stamp/Date', false], ['Accepted By', false], ['Date', false], ['14/07/2026', false],
 ['sales@vendor.com', false], ['a', false]]
  .forEach(([line, want]) => {
    eq(JSON.stringify(line) + (want ? ' is' : ' is not') + ' a company name',
      app.looksLikeCompanyName(line), want);
  });

// The guess can land on us -- a quotation HKT itself issued is signed by HKT --
// and that must soften the cross-check rather than raise a conflict. The legal
// name is what a sign-off block prints, and normName leaves it as three tokens
// no core-name test can see.
ok('our own legal name is recognised as us',
  app.isOurCompanyName(app.DIFF_KEYS.vendor('Hong Kong Telecommunications (HKT) Limited')));
ok('and so is the short form', app.isOurCompanyName(app.DIFF_KEYS.vendor('HKT Limited')));
ok('a real counterparty sharing part of the name is not us',
  !app.isOurCompanyName(app.DIFF_KEYS.vendor('PCCW Digital Solutions Limited')));
ok('nor is a customer whose name merely starts the same way',
  !app.isOurCompanyName(app.DIFF_KEYS.vendor('Hong Kong Design Centre Limited')));
ok('naming us where the other names a vendor is softened, not flagged',
  app.ourCompanyOnlyDissent([
    { norm: app.DIFF_KEYS.vendor('Cisco') },
    { norm: app.DIFF_KEYS.vendor('Hong Kong Telecommunications (HKT) Limited') },
  ]));

/* ---------- the "To" fallback ---------- */

eq('a quotation addressed to a company still reads as the customer',
  app.mapDetectedFields([{ label: 'To', value: 'Hong Kong Design Centre' }], null).customerName,
  'Hong Kong Design Centre');
eq('an email header\'s "To:" is not a customer name',
  app.mapDetectedFields([{ label: 'To', value: 'Abby.NY.Chan@pccw.com' }], null).customerName,
  undefined);
eq('...nor is a run of HTML entities',
  app.mapDetectedFields([{ label: 'To', value: '&nbsp;&nbsp;&nbsp; Abby' }], null).customerName,
  undefined);

// The third header shape, and the one that reached a real screen: a parsed mail
// thread pushes header junk into its container's field list, and what survives
// of "Cheung, Marcus TH" under `To` is the surname plus its own comma. Measured
// on an upload whose Quotation column read Customer Name = "Cheung,".
//
// The shape alone is enough to refuse it -- a company name never ends in a
// comma -- which is why this is a value reject rather than a label one: `To` on
// a quotation IS the customer, and the two assertions above this depend on that.
eq('an email header\'s trailing-comma name fragment is not a customer name',
  app.mapDetectedFields([{ label: 'To', value: 'Cheung,' }], null).customerName, undefined);
eq('...and neither is a full "Surname, Given" that lost its given name',
  app.mapDetectedFields([{ label: 'To', value: 'Cheng, ' }], null).customerName, undefined);
// The other headers a .eml pushes in have the same trailing comma; none of them
// is read as a customer either, and `From`/`Sent` are not even `To`.
eq('a comma INSIDE a name is untouched -- only a trailing one is a fragment',
  app.mapDetectedFields([{ label: 'To', value: 'Cheung, Marcus TH' }], null).customerName,
  'Cheung, Marcus TH');
eq('a company name with a comma in it still reads',
  app.mapDetectedFields([{ label: 'To', value: 'ABC Trading Co., Limited' }], null).customerName,
  'ABC Trading Co., Limited');
// A rejected value must not fall through to some other key by a looser route.
eq('a rejected "To" leaves the row empty rather than moving it',
  JSON.stringify(app.mapDetectedFields([{ label: 'To', value: 'Cheung,' }], null)), '{}');

/* ---------- the widened amount pattern stays narrow ---------- */

['Total Qty', 'Total Hours', 'Total Days', 'Total Items'].forEach(label => {
  eq('"' + label + '" is not an amount',
    app.mapDetectedFields([{ label, value: '12' }], null).hkd, undefined);
});
[['Total Amount (HK$)', '$4,000.0'], ['Sub-Total', '4,000.00'], ['Project Total', '4,000.00'],
 ['Grand Total', '9,900'], ['Total', '120'], ['Total Value of Quotation (HKD)', '128400'],
 // The ATQ spells this row out in full; a vendor's own quotation abbreviates it
 // to "Total Value", and the two are the same row on the reviewer's mapping.
 // Only `total value ... hkd` and `value of quotation` were matched before, so
 // the bare form fell through.
 ['Total Value', '4,000.00'], ['Total Value (HKD)', '4,000.00'], ['Total Value (HK$)', '4,000.00']]
  .forEach(([label, value]) => {
    eq('"' + label + '" is an amount',
      app.mapDetectedFields([{ label, value }], null).hkd, value);
  });
// Anchored at both ends like every amount pattern here. The USD half matters
// twice over: Dataverse keeps admin_totalvaluehkd2 and admin_totalvalueusd as
// separate columns, so a USD figure in the HKD row is a wrong value rather than
// a missing one.
['Total Value (USD)', 'Total Value of Goods Sold', 'Total Valuation'].forEach(label => {
  eq('"' + label + '" is not the HKD amount',
    app.mapDetectedFields([{ label, value: '4,000.00' }], null).hkd, undefined);
});

/* ---------- 3. A third dialect: the maintenance-quotation letter ----------

   DCSS's quotation is laid out as a letter, and it names both companies —
   which is exactly why the two rows below are the ones that go wrong:

     Company Name:  HKT Limited      <- the BUYER. That is us.
     End user:      OCBC             <- the customer the ATQ names.

   Reading "Company Name" as the customer would print "HKT Limited" in the
   Quotation column's Customer Name and quietly contradict the ATQ on every
   upload, so customerName learns "End user" and deliberately does NOT learn
   "Company Name". It learns it as a FALLBACK, not a FIELD_LABEL_MAP pattern:
   up there "first match wins" means the document's own order decides, so a
   document carrying both labels would hand the row to whichever the engine
   happened to report first. As a fallback, "Customer Name" always wins.

   Its sign-off is the Xtreme Lighting shape (two columns collapsed onto one
   line, the company left standing under them) with a different cue: a letter
   closes "Yours Sincerely", not "For and on behalf of", and prints the company
   with a lower-case "for" in front of it.

   Fixtures are the real engine's output for
   `3. DCSS HK_Quotation_PID20260316-HWMA-HKT-21292.pdf`, taken through
   `_test/_test/harness/engine.js` (a two-page text-layer PDF, so no OCR is
   involved and this is reproducible under Node). */

const DCSS_FIELDS = [
  { label: 'Original Quote Date', value: '16-Mar-2026' },
  { label: 'Quote Ref', value: 'PID20260316-HWMA-HKT-21292' },
  { label: 'Company Name', value: 'HKT Limited' },
  { label: 'Attention', value: 'Ms. Kiwi Wong' },
  { label: 'Currency', value: 'HKD' },
  { label: 'Quote Valid To', value: '15-Apr-2026' },
  { label: 'Prepared by', value: 'Philip Chan' },
  { label: 'Email Address', value: 'Kiwi.LF.Wong@pccw.com' },
  { label: 'End user', value: 'OCBC' },
  { label: 'Confirmed & Accepted By', value: 'for DCSS Technology (Hong Kong) Ltd' },
  { label: 'Name', value: 'Philip Chan Authorised Signature & Company Stamp' },
  { label: 'Title', value: 'Account Manager' },
];

const DCSS_TEXT = [
  'PLEASE SIGN THIS MAINTENANCE SERVICE QUOTATION AND RETURN A COPY ALONG WITH YOUR PURCHASE ORDER.',
  '',
  'Yours Sincerely ,   Confirmed & Accepted By :',
  'for DCSS Technology (Hong Kong) Ltd',
  '',
  'Philip',
  '……………………………………………………………………………………………………...……   ……………………………………………………………………………………………………...……',
  'Name: Philip Chan   Authorised Signature & Company Stamp',
  'Title: Account Manager   Name: ………………………………………..……………………………..',
  'Date: 16-Mar-2026   Designation: ……………………………………………………………….',
].join('\n');

// Page 2's price table, in the engine's own line order. The point of keeping all
// of it: the amount appears FOUR times and only the last line pairs its label
// with its figure. "Grand Total" and "HKD 1,755" sit at opposite ends of a table
// row, so the engine pairs neither with the other and reports the figure as its
// own label -- the real field list carries `"HKD 1,755" => "HKD 1,755"`, which no
// amount pattern can read, and "Grand Total" never becomes a label at all.
const DCSS_TOTALS = [
  'Total Day(s)',
  'Price (HKD)',
  'HKD 2,340',
  'Total Price (HKD)',
  'HKD 1,755',
  '16. Price quoted is based on a total package. Any changes in quantity or model'
    + ' may affect Unit Price and would require a re-quote from DCSS Technology.',
  'Grand Total HKD 1,755',
].join('\n');

const dcss = app.mapDetectedFields(DCSS_FIELDS, 'Vendor Quotation', DCSS_TEXT);
eq('"End user" is the customer a quotation letter names', dcss.customerName, 'OCBC');
eq('"Quote Ref" is the quotation number', dcss.quotation, 'PID20260316-HWMA-HKT-21292');
eq('the company under "Yours Sincerely" is the vendor',
  dcss.vendor, 'DCSS Technology (Hong Kong) Ltd');
eq('no label on this page reports an amount', dcss.hkd, undefined);
eq('...so the amount is read out of the document\'s own text',
  app.mapDetectedFields(DCSS_FIELDS, 'Vendor Quotation', DCSS_TEXT + '\n' + DCSS_TOTALS).hkd,
  '1,755');

// The trap: the buyer is named on the page too, and it is us.
eq('"Company Name" is the buyer, never the customer',
  app.mapDetectedFields([{ label: 'Company Name', value: 'HKT Limited' }], 'Vendor Quotation').customerName,
  undefined);
eq('a labelled customer still outranks "End user"',
  app.mapDetectedFields([{ label: 'End user', value: 'OCBC' },
    { label: 'Customer Name', value: 'OCBC BANK (HONG KONG) LIMITED' }], null).customerName,
  'OCBC BANK (HONG KONG) LIMITED');

// The cue on its own, and the lower-case "for" the letter prints.
eq('"Yours Sincerely" is a sign-off cue', app.vendorFromText(DCSS_TEXT),
  'DCSS Technology (Hong Kong) Ltd');
eq('"Yours faithfully" too',
  app.vendorFromText('Yours faithfully,\nfor ACME Trading Company Limited\nName:'),
  'ACME Trading Company Limited');
eq('a leading "for" is not part of the company name',
  app.vendorFromText('For and on behalf of\nfor Systec Engineering Limited'),
  'Systec Engineering Limited');
// Still bounded the same way: a letter that closes twice is not something a
// guess should answer, and boilerplate is still not a company.
eq('two closings -> no guess',
  app.vendorFromText('Yours sincerely\nABC Trading Limited\nYours sincerely\nXYZ Holdings Limited'),
  null);
eq('a closing with nothing but furniture under it',
  app.vendorFromText('Yours Sincerely ,\nAuthorised Signature & Company Stamp\nName:\nDate:'), null);
// The end-user pattern is anchored, so a neighbouring label cannot borrow it.
['End user address', 'End user contact', 'End users list'].forEach(label => {
  eq('"' + label + '" is not a customer name',
    app.mapDetectedFields([{ label, value: 'Kwun Tong' }], null).customerName, undefined);
});

/* ---------- hkdTotalFromText on its own ----------

   The one thing that makes guessing an AMOUNT out of free text safe enough: the
   currency has to be stated. The row this fills is HKD, so a line must say HKD
   or HK$ before its number is taken, and it must begin with a Total -- which is
   what keeps the same page's "Price (HKD) HKD 2,340" unit price out of it. */

eq('the joined line is the one that answers', app.hkdTotalFromText(DCSS_TOTALS), '1,755');
// Only the joined line. Each of these is a real line of the same document.
eq('a label with no figure on it', app.hkdTotalFromText('Grand Total'), null);
eq('a figure with no label on it', app.hkdTotalFromText('HKD 1,755'), null);
eq('a label and figure on separate lines are not a line',
  app.hkdTotalFromText('Total Price (HKD)\nHKD 1,755'), null);
eq('the unit price is not the total', app.hkdTotalFromText('Price (HKD) HKD 2,340'), null);
eq('...not even labelled per-day', app.hkdTotalFromText('Unit Price HKD 2,340 per day'), null);

// The spellings a quotation actually prints.
[['Grand Total HKD 1,755', '1,755'], ['Total HK$ 4,000.00', '4,000.00'],
 ['Sub-Total HKD 4,000', '4,000'], ['Sub Total HK$ 120', '120'],
 ['Net Total HKD 599,000.00', '599,000.00'], ['Project Total HKD 9,900', '9,900'],
 ['Total: HKD 120', '120'], ['Total Price (HKD) HKD 1,755', '1,755'],
 ['Total Amount HK$1,755', '1,755']]
  .forEach(([line, want]) => {
    eq(JSON.stringify(line) + ' -> ' + want, app.hkdTotalFromText(line), want);
  });

// The currency is the whole guard. Without it stated, this reader stays silent
// and the row is left to the labelled pass -- a missing amount is recoverable,
// a USD figure printed in the HKD row is not.
eq('a total with no currency stated', app.hkdTotalFromText('Grand Total 1,755'), null);
eq('a total in another currency', app.hkdTotalFromText('Grand Total USD 1,755'), null);
eq('...even one whose symbol merely looks similar',
  app.hkdTotalFromText('Grand Total US$ 1,755'), null);
eq('a count is not an amount', app.hkdTotalFromText('Total Day(s) 3'), null);
eq('"Total" inside a sentence is not a row',
  app.hkdTotalFromText('Price quoted is based on a total package of HKD 1,755'), null);
// Anchored at the end, so trailing prose cannot drag an unrelated figure in.
eq('a total with a trailing note is not read',
  app.hkdTotalFromText('Grand Total HKD 1,755 (exclusive of tax)'), null);
eq('no text at all', app.hkdTotalFromText(''), null);
eq('nothing passed', app.hkdTotalFromText(null), null);
// It runs only when no label answered, like every other text reader here.
eq('a labelled amount still wins over the text pass',
  app.mapDetectedFields([{ label: 'Total Amount (HK$)', value: '$4,000.0' }],
    'Vendor Quotation', DCSS_TOTALS).hkd,
  '$4,000.0');

/* ---------- 2. One quotation per item ---------- */

// An ATQ covering items 2 and 3, one quotation attachment each -- the shape
// parseFile returns for a multi-item email.
function twoItemUpload() {
  const attachments = JSON.parse(JSON.stringify(app.EMPTY_ATTACHMENTS));
  const records = [
    { quotationRef: 'QT-2600008', quotationFiles: ['QT-2600008 quote.pdf'], fields: [
      { label: 'Item No.', value: '2' },
      { label: 'Quotation', value: 'QT-2600008' },
      { label: 'Customer Name', value: 'HK DESIGN CENTRE LIMITED' },
    ] },
    { quotationRef: 'Q2026050009R', quotationFiles: ['Q2026050009R quote.pdf'], fields: [
      { label: 'Item No.', value: '3' },
      { label: 'Quotation', value: 'Q2026050009R' },
      { label: 'Customer Name', value: 'HK DESIGN CENTRE LIMITED' },
    ] },
  ];
  attachments.ATQ = {
    parsed: true, file: 'mail.eml', text: '', isAtqRecord: true, error: null,
    phase: 'full', pendingDocs: [], pages: [], records, rawFields: records[0].fields,
    docs: [
      { index: 0, fileName: 'ATQ-202604-00177-V03.pdf', fields: [
        { label: 'ATQ Ref. No.', value: 'ATQ-202604-00177-V03' },
      ], records },
      { index: 1, fileName: 'QT-2600008 quote.pdf', fields: [
        { label: 'Quotation No.', value: 'QT-2600008' },
        { label: 'On Behalf of', value: 'NEXUS2S Asia Limited' },
        { label: 'Total Amount (HK$)', value: '$4,000.00' },
      ] },
      { index: 2, fileName: 'Q2026050009R quote.pdf', fields: [
        { label: 'Quotation No', value: 'Q2026050009R' },
        { label: 'On Behalf of', value: 'Xtreme Lighting Limited' },
        { label: 'Total Amount (HK$)', value: '$8,000.00' },
      ] },
      // The forwarded vendor mail that used to fill Customer Name with the
      // recipient's address, purely because its filename says "quote".
      { index: 3, fileName: 'Updated vendor quote_for HKDC.mht', fields: [
        { label: 'To', value: 'Abby.NY.Chan@pccw.com' },
      ] },
    ],
  };
  return attachments;
}

const upload = twoItemUpload();

function quotationCell(itemIndex, key) {
  const diffs = app.computeFieldDiffs(upload, itemIndex);
  const census = app.roleCensus(upload, null, app.offItemQuotationTest(upload, itemIndex));
  const crosschecks = app.computeCrosschecks(diffs, census);
  return app.roleCellValue(crosschecks, key, 'quotation');
}

eq('item 1 reads the quotation the ATQ names for item 1',
  quotationCell(0, 'quotation'), 'QT-2600008');
eq('...and its vendor', quotationCell(0, 'vendor'), 'NEXUS2S Asia Limited');
eq('...and its amount', quotationCell(0, 'hkd'), '$4,000.00');
eq('item 2 reads the other quotation', quotationCell(1, 'quotation'), 'Q2026050009R');
eq('...and its vendor', quotationCell(1, 'vendor'), 'Xtreme Lighting Limited');
eq('...and its amount', quotationCell(1, 'hkd'), '$8,000.00');
eq('the forwarded mail\'s "To:" never reaches Customer Name',
  quotationCell(0, 'customerName'), '');

const test = app.offItemQuotationTest(upload, 0);
ok('the item\'s own quotation is not ruled out', !test('ATQ', 'QT-2600008 quote.pdf'));
ok('the other item\'s quotation is', test('ATQ', 'Q2026050009R quote.pdf'));
ok('a quotation dropped on its own tab is never ruled out -- it was never a '
  + 'candidate for quotationFiles', !test('Vendor Quotation', 'some other quote.pdf'));

// The census still offers the ruled-out file, so the reviewer can pin it.
const census0 = app.roleCensus(upload, null, test);
ok('a ruled-out quotation stays assignable by hand',
  census0.docs.some(d => d.fileName === 'Q2026050009R quote.pdf' && d.role === null),
  census0.docs.map(d => [d.fileName, d.role]));
eq('and the slot itself names the item\'s own quotation',
  census0.assigned.quotation && census0.assigned.quotation.doc.fileName, 'QT-2600008 quote.pdf');

// An explicit pin still wins over the item scoping.
const pinned = app.roleCensus(upload, { quotation: 'ATQ#2' }, test);
eq('an explicit reassignment overrides the item scoping',
  pinned.assigned.quotation && pinned.assigned.quotation.doc.fileName, 'Q2026050009R quote.pdf');

/* ---------- 2b. no quotationFiles: scope by the item's own vendor ------------

   The QUOTATION column of the ATQ form is optional and often left blank.
   `ATQ-202603-00386-V23` leaves it empty in BOTH its PDF and its workbook, so the
   engine had no reference to resolve, `record.quotationFiles` came back undefined
   for every item, and the documented "no filtering at all" fallback offered the
   email's one DCSS quotation to every item: item 1 took it and item 2 -- the DCSS
   item -- showed none.

   The item still says who it bought from, though, and the quotation names its own
   issuer. Fixture is the real measured shape: two workbook records (ATQ Item No.
   2 and 3, "Item 2 & 3"), a blank Quotation cell on both, and the one DCSS
   quotation the email carried.

   Note what the quotation doc does NOT have: a vendor label. Its vendor is only
   in its sign-off block, which is why vendorByQuotationFile has to read each
   document through mapDetectedFields rather than looking for a labelled field. */

function blankQuotationColumnUpload() {
  const attachments = JSON.parse(JSON.stringify(app.EMPTY_ATTACHMENTS));
  const records = [
    { fields: [
      { label: 'Item No.', value: '2' },
      { label: 'Vendor / Distributor', value: 'HUAWEI' },
      { label: 'Total Value of Quotation (HKD)', value: '79596.04' },
      { label: 'Quotation', value: '' },
    ] },
    { fields: [
      { label: 'Item No.', value: '3' },
      { label: 'Vendor / Distributor', value: 'DCSS Technology (Hong Kong) Ltd' },
      { label: 'Total Value of Quotation (HKD)', value: '1755' },
      { label: 'Quotation', value: '' },
    ] },
  ];
  const atqFields = [{ label: 'ATQ Ref. No.', value: 'ATQ-202603-00386-V23' }];
  attachments.ATQ = {
    parsed: true, file: 'mail.eml', text: '', isAtqRecord: true, error: null,
    phase: 'full', pendingDocs: [], pages: [], records, rawFields: atqFields,
    docs: [
      { index: 0, fileName: 'ATQ-202603-00386-V23.pdf', fields: atqFields, records },
      { index: 1, fileName: '3. DCSS HK_Quotation_PID20260316-HWMA-HKT-21292.pdf',
        fields: DCSS_FIELDS, textBlock: DCSS_TEXT + '\n' + DCSS_TOTALS },
    ],
  };
  return attachments;
}

const blank = blankQuotationColumnUpload();
const DCSS_FILE = '3. DCSS HK_Quotation_PID20260316-HWMA-HKT-21292.pdf';

ok('the engine matched no quotation file for either item',
  !blank.ATQ.records[0].quotationFiles && !blank.ATQ.records[1].quotationFiles);

const huaweiItem = app.offItemQuotationTest(blank, 0);
const dcssItem = app.offItemQuotationTest(blank, 1);
ok('a DCSS quotation is not the HUAWEI item\'s', huaweiItem('ATQ', DCSS_FILE));
ok('it is the DCSS item\'s', !dcssItem('ATQ', DCSS_FILE));
ok('the container scope still applies -- a quotation dropped on its own tab is '
  + 'never ruled out', !huaweiItem('Vendor Quotation', DCSS_FILE));

// What the reviewer sees: the slot is empty under the HUAWEI item rather than
// filled with the other item's vendor and amount.
const huaweiCensus = app.roleCensus(blank, null, huaweiItem);
eq('the HUAWEI item\'s Quotation slot is empty',
  huaweiCensus.assigned.quotation, null);
ok('...and the ruled-out quotation is still assignable by hand',
  huaweiCensus.docs.some(d => d.fileName === DCSS_FILE && d.role === null),
  huaweiCensus.docs.map(d => [d.fileName, d.role]));
eq('an explicit pin overrides the vendor scoping too',
  (app.roleCensus(blank, { quotation: 'ATQ#1' }, huaweiItem).assigned.quotation || {}).doc
    && app.roleCensus(blank, { quotation: 'ATQ#1' }, huaweiItem).assigned.quotation.doc.fileName,
  DCSS_FILE);

const dcssCensus = app.roleCensus(blank, null, dcssItem);
eq('the DCSS item\'s Quotation slot names the DCSS quotation',
  dcssCensus.assigned.quotation && dcssCensus.assigned.quotation.doc.fileName, DCSS_FILE);

function blankCell(itemIndex, key) {
  const diffs = app.computeFieldDiffs(blank, itemIndex);
  const census = app.roleCensus(blank, null, app.offItemQuotationTest(blank, itemIndex));
  return app.roleCellValue(app.computeCrosschecks(diffs, census), key, 'quotation');
}
eq('the HUAWEI item\'s Quotation column reports no vendor', blankCell(0, 'vendor'), '');
eq('...and no amount', blankCell(0, 'hkd'), '');
eq('the DCSS item\'s reports its vendor', blankCell(1, 'vendor'), 'DCSS Technology (Hong Kong) Ltd');
// "1755", not the quotation's own "1,755": the two agree, so they are ONE group
// and the cell draws the group's value -- which the ATQ, being first, created.
// That the quotation column is not "" is the whole point; the exact spelling is
// the shared reading, and a reviewer sees two columns agreeing rather than one
// blank one.
eq('...its amount, as the reading it shares with the ATQ', blankCell(1, 'hkd'), '1755');
eq('...its customer', blankCell(1, 'customerName'), 'OCBC');
eq('...and its quotation number', blankCell(1, 'quotation'), 'PID20260316-HWMA-HKT-21292');

/* ---------- 2c. shared Agreement data must survive item switching ---------- */

function sharedAgreementUpload() {
  const attachments = JSON.parse(JSON.stringify(app.EMPTY_ATTACHMENTS));
  const records = [
    { fields: [{ label: 'Item No.', value: '1' }] },
    { fields: [{ label: 'Item No.', value: '2' }] },
  ];
  attachments.ATQ = {
    parsed: true, file: 'request.eml', text: '', isAtqRecord: true,
    phase: 'full', pendingDocs: [], pages: [], records, rawFields: [], docs: [
      { index: 0, fileName: 'request.eml', fields: [], records },
      { index: 1, fileName: 'Shared Service Agreement.pdf', fields: [],
        records: [], textBlock: 'On behalf of: Shared Vendor Ltd\n'
          + 'Grand Total HKD 4000.00\n'
          + 'Contract Reference No  AGR-2026-0001' },
      { index: 2, fileName: 'Vendor quotation.pdf', fields: [
        { label: 'Quotation No.', value: 'QT-2026-0001' },
      ], records: [] },
    ],
  };
  return attachments;
}

const shared = sharedAgreementUpload();
function sharedAgreementCell(itemIndex, key) {
  const diffs = app.computeFieldDiffs(shared, itemIndex);
  const census = app.roleCensus(shared, null, app.offItemQuotationTest(shared, itemIndex));
  return app.roleCellValue(app.computeCrosschecks(diffs, census), key, 'agreement');
}
eq('shared Agreement vendor remains on Item 1',
  sharedAgreementCell(0, 'vendor'), 'Shared Vendor Ltd');
eq('shared Agreement vendor remains on Item 2',
  sharedAgreementCell(1, 'vendor'), 'Shared Vendor Ltd');
eq('shared Agreement amount remains on Item 2',
  sharedAgreementCell(1, 'hkd'), '4000.00');
eq('shared Agreement contract number is not treated as quotation number',
  sharedAgreementCell(1, 'contractNo'), 'AGR-2026-0001');
eq('the Agreement column does not borrow the quotation number',
  sharedAgreementCell(1, 'quotation'), '');
function sharedQuotationCell(itemIndex, key) {
  const diffs = app.computeFieldDiffs(shared, itemIndex);
  const census = app.roleCensus(shared, null, app.offItemQuotationTest(shared, itemIndex));
  return app.roleCellValue(app.computeCrosschecks(diffs, census), key, 'quotation');
}
eq('the Quotation column owns the quotation number',
  sharedQuotationCell(1, 'quotation'), 'QT-2026-0001');

/* ---------- the fallback rules OUT, and never rules IN ----------

   Deliberately weaker than the reference match. Every unknown -- an item that
   names no vendor, a document whose vendor cannot be read -- keeps the old "no
   filtering at all" behaviour, because a wrong exclusion would hide the only
   quotation the email has. */

const noItemVendor = blankQuotationColumnUpload();
noItemVendor.ATQ.records.forEach(r => {
  r.fields = r.fields.filter(f => !/vendor/i.test(f.label));
});
const openByItem = app.offItemQuotationTest(noItemVendor, 0);
ok('an item that names no vendor filters nothing',
  !openByItem('ATQ', DCSS_FILE) && !openByItem('ATQ', 'anything.pdf'));

const unreadableVendor = blankQuotationColumnUpload();
unreadableVendor.ATQ.docs[1] = { index: 1, fileName: DCSS_FILE,
  fields: [{ label: 'Quote Ref', value: 'PID20260316-HWMA-HKT-21292' }], textBlock: '' };
ok('a quotation whose vendor cannot be read is not ruled out',
  !app.offItemQuotationTest(unreadableVendor, 0)('ATQ', DCSS_FILE));

// The same fuzzy rule the cross-check uses, because `vendor` is a FUZZY_DIFF_KEYS
// member: a document that says "(HK) Limited" where the ATQ says "(Hong Kong)
// Ltd" is one vendor here for the same reason it raises no conflict there.
ok('the same vendor spelled two ways agrees',
  app.vendorsAgree('DCSS Technology (Hong Kong) Ltd', 'DCSS Technology (HK) Limited'));
ok('an identical name agrees', app.vendorsAgree('HUAWEI', 'HUAWEI'));
ok('two different vendors do not',
  !app.vendorsAgree('HUAWEI', 'DCSS Technology (Hong Kong) Ltd'));
ok('an unreadable side never agrees', !app.vendorsAgree('', 'HUAWEI'));
ok('...on either side', !app.vendorsAgree('HUAWEI', null));
ok('nor do two unreadable sides', !app.vendorsAgree(null, undefined));

/* ---------- nothing to scope by at all -> unchanged behaviour ---------- */

// The reference match is what this upload loses; its records carry no vendor
// column either, so it falls all the way through to no filtering.
const noFiles = twoItemUpload();
noFiles.ATQ.records.forEach(r => { delete r.quotationFiles; });
const openTest = app.offItemQuotationTest(noFiles, 0);
ok('an upload with neither a matched quotation nor an item vendor filters nothing',
  !openTest('ATQ', 'Q2026050009R quote.pdf') && !openTest('ATQ', 'anything.pdf'));
// No ATQ records at all -- a quotation dropped on its own, the common single-file
// upload -- has no item to scope by and must be left alone.
ok('an upload with no ATQ records filters nothing',
  !app.offItemQuotationTest(JSON.parse(JSON.stringify(app.EMPTY_ATTACHMENTS)), 0)(
    'Vendor Quotation', 'some quote.pdf'));

/* ---------- report ---------- */

if (failures.length) {
  console.error(passed + ' passed, ' + failures.length + ' failed');
  failures.forEach(f => console.error('  FAIL  ' + f));
  process.exit(1);
}
console.log(passed + ' passed, 0 failed');
