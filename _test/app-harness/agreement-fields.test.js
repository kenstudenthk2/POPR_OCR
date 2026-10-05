// What a SCANNED agreement contributes to the Extracted Fields table.
//
//   node _test/app-harness/agreement-fields.test.js
//
// The fixture is the real engine's output for `L260390185MZ signed contract.pdf`
// -- 22 pages of CCITTFax scan, natively 1654x2340 on a 595x842pt page, run
// through `DocparseEngine.parseFile(file, onStatus, { markContext: true })` in a
// real browser (there is no way to reach it under Node: no canvas, no OCR
// model). 74 label:value pairs came back; the eight below are the ones the
// Agreement column lives or dies on.
//
// The point of writing them down: OCR read this document WELL. Every one of the
// four values the Agreement column reported as missing was present and legible
// -- "OCBC Contract Reference No: L260390185MZ" is printed on all 22 pages and
// came back clean from every one of them. Nothing here is an OCR-accuracy
// problem. They are label-vocabulary problems, and two of them are the same
// problem twice:
//
//   1. A two-column table's HEADER ROW pairs as a label:value. The contract
//      prints a parties table headed "Customer | Project" and a term table
//      headed "Start Date | End Date", so customerName read "Project" and
//      startDate read "End Date" -- a wrong value each, not a missing one, which
//      is worse: a reviewer sees a filled row and no conflict mark.
//   2. "Contract Reference No" puts a word between the two the pattern needed
//      adjacent.
//   3. "Maintenance Period" states its range with a dash, not the word "to".

const { load } = require('./app.js');
const app = load();

let passed = 0;
const failures = [];
function ok(label, cond, detail) {
  if (cond) { passed++; return; }
  failures.push(label + (detail === undefined ? '' : '\n      got: ' + JSON.stringify(detail)));
}
function eq(label, actual, expected) { ok(label, actual === expected, { actual, expected }); }

// Measured output, in the engine's own order.
const CONTRACT_FIELDS = [
  { label: 'OCBC Contract Reference No', value: 'L260390185MZ' },
  { label: 'Modification Date', value: 'Mar 2026' },
  { label: 'Start Date', value: 'End Date' },                    // <- header row
  { label: '1-Apr-2026', value: '31-Mar-2027' },                 // <- its values
  { label: 'Customer', value: 'Project' },                       // <- header row
  { label: 'Name', value: 'Leong Mun Fai' },
  { label: 'Email', value: 'munfaileong@ocbc.com' },
  { label: 'OCBC BANK (HONGKONG) LIMITED', value: 'OCBC Bank (Hong Kong) Limited' },
  { label: 'Maintenance Period', value: '1 Apr 2026 - 31 Mar 2027' },
  { label: 'The Total Maintenance Service Price', value: 'HK$599,000.00' },
];

const agreement = app.mapDetectedFields(CONTRACT_FIELDS, 'Contract');

/* ---------- 1. the number the document is named after ---------- */

eq('"Contract Reference No" is a contract number',
  agreement.contractNo, 'L260390185MZ');
// The two spellings that already worked must keep working.
eq('"Agreement Number" still is',
  app.mapDetectedFields([{ label: 'Agreement Number', value: 'L260390185MZ' }], 'Contract').contractNo,
  'L260390185MZ');
eq('"Contract No." still is',
  app.mapDetectedFields([{ label: 'Contract No.', value: 'L260390185MZ' }], 'Contract').contractNo,
  'L260390185MZ');
eq('"Contract Ref" on its own is too',
  app.mapDetectedFields([{ label: 'Contract Ref', value: 'L260390185MZ' }], 'Contract').contractNo,
  'L260390185MZ');
// Anchored at the end, so a neighbouring label cannot borrow it.
eq('"Contract Reference Date" is not a contract number',
  app.mapDetectedFields([{ label: 'Contract Reference Date', value: '25-Mar-2026' }], 'Contract').contractNo,
  undefined);

/* ---------- 1b. the ATQ's own agreement number, hidden in a four-column row ----

   The engine's line pass reads the row correctly; it is a `para` block holding
   label/value/label/value, and the paragraph field reader pairs one label with
   one value. So the ATQ (PDF) column showed no contract number and only the
   workbook had one -- a reviewer saw one side blank instead of two sides
   agreeing. Measured line, from ATQ-202603-00386-V23 page 1 block 7. */

const ATQ_PART3_LINE =
  'Part3 Contract Details\n'
  + 'Agreement Number   L260390185MZ   Previous Agreement Number   L250300109KW\n'
  + 'Contract Month   18                 12';

eq('the ATQ\'s agreement number is read out of its form row',
  app.contractNoFromText(ATQ_PART3_LINE), 'L260390185MZ');
// The trap: the PREVIOUS number is a valid-looking reference two cells away.
eq('the previous agreement number is never the answer',
  app.contractNoFromText('Previous Agreement Number   L250300109KW'), null);
eq('...not even when it is the only one on the line',
  app.contractNoFromText('Previous Contract No.   L250300109KW'), null);
eq('a single-space form row is not a column boundary',
  app.contractNoFromText('The agreement number L260390185MZ was superseded'), null);
eq('"N/A" is not a reference', app.contractNoFromText('Agreement Number   N/A'), null);
eq('a document that never states one',
  app.contractNoFromText('Quotation No.   Q2026050009R'), null);
eq('no text at all', app.contractNoFromText(''), null);
// It runs only when no label answered, like every other text reader here.
eq('a labelled contract number still wins over the text pass',
  app.mapDetectedFields([{ label: 'Agreement Number', value: 'L999999999ZZ' }], 'ATQ',
    ATQ_PART3_LINE).contractNo,
  'L999999999ZZ');
eq('...and the text pass fills it when no label did',
  app.mapDetectedFields([{ label: 'ATQ Ref. No.', value: 'ATQ-202603-00386-V23' }], 'ATQ',
    ATQ_PART3_LINE).contractNo,
  'L260390185MZ');

/* ---------- 2. a header row is not a label:value pair ---------- */

// "Project" is the next COLUMN HEADER, not this customer's name. Reporting
// nothing is the right answer here: the contract never labels its customer.
eq('a column header is not a customer name', agreement.customerName, undefined);
eq('...nor is one a start date', agreement.startDate, '1 Apr 2026');

// The reject is on the value, not the label: a bare "Customer" label is real and
// one document in the corpus uses it
// (e1.eml, "Customer" => "Airport Authority Hong Kong(FL# 50429573)").
eq('a bare "Customer" label still reads a real name',
  app.mapDetectedFields([{ label: 'Customer', value: 'Airport Authority Hong Kong(FL# 50429573)' }],
    'Contract').customerName,
  'Airport Authority Hong Kong(FL# 50429573)');
eq('...including a short one', app.mapDetectedFields([{ label: 'Customer', value: 'OCBC' }],
  'Contract').customerName, 'OCBC');
// The vocabulary is the app's own label words, so it stays in step with
// FIELD_LABEL_MAP rather than being a list of banned strings.
['Project', 'Vendor', 'Quotation', 'Amount', 'Total', 'Date', 'Description', 'Item',
 'Remarks', 'Currency', 'Qty'].forEach(word => {
  eq('"' + word + '" is a column header, not a customer',
    app.mapDetectedFields([{ label: 'Customer', value: word }], 'Contract').customerName, undefined);
});
// Anchored whole: a company whose name merely contains one of them is untouched.
[['Total Sports Limited', 'customerName'], ['Project Alpha Holdings Ltd', 'customerName'],
 ['Item Logistics Company', 'customerName']].forEach(([value]) => {
  eq(JSON.stringify(value) + ' is a real name',
    app.mapDetectedFields([{ label: 'Customer', value }], 'Contract').customerName, value);
});

/* ---------- 3. a period stated with a dash ---------- */

// With startDate no longer holding "End Date", the period pass is reached and
// the contract's own term lands in both rows.
eq('"Maintenance Period" fills the start date', agreement.startDate, '1 Apr 2026');
eq('...and the end date', agreement.endDate, '31 Mar 2027');

eq('the word "to" still splits a period',
  JSON.stringify(app.splitPeriodRange('01-Jul-2026 to 30-Jun-2027')),
  JSON.stringify({ start: '01-Jul-2026', end: '30-Jun-2027' }));
eq('a spaced hyphen splits one',
  JSON.stringify(app.splitPeriodRange('1 Apr 2026 - 31 Mar 2027')),
  JSON.stringify({ start: '1 Apr 2026', end: '31 Mar 2027' }));
eq('an en dash does too',
  JSON.stringify(app.splitPeriodRange('1 Apr 2026 – 31 Mar 2027')),
  JSON.stringify({ start: '1 Apr 2026', end: '31 Mar 2027' }));
// The hyphens INSIDE an ISO or d-mmm-yyyy date must not split it -- that is why
// the separator has to be surrounded by spaces.
eq('an ISO date is one date, not a range',
  app.splitPeriodRange('2026-04-01'), null);
eq('a d-mmm-yyyy date is one date',
  app.splitPeriodRange('1-Apr-2026'), null);
eq('a hyphenated range with no spaces stays one value',
  app.splitPeriodRange('1-Apr-2026-31-Mar-2027'), null);
eq('a period the document never states', app.splitPeriodRange('Please refer to Appendix'), null);

/* ---------- A letter of award, which is an agreement in a letter's clothing ---------- */

// Measured on a real scanned Letter of Award (1 page, no text layer at all),
// parsed in a browser with { markContext: true }. Its terms are laid out as a
// two-column form whose separator is a column of its own:
//
//   Service Period  |  | : | 1 May 2026 to 30 Apr 2027 (Both dates inclusive)
//   Contract Sum    |  | : | HK$6,137,434.00
//
// Every one of those rows used to reach the App as nothing at all -- the table
// shape that reads them is new, and the engine test for it is in
// sheet-fields.test.js' sibling territory. Amounts and the reference are
// substituted; the labels, the layout and the value shapes are not.
const AWARD = [
  { label: 'Ref. No.', value: 'AIR/L0495/2026' },
  { label: 'Date', value: '21 Apr 2026' },
  { label: 'Re', value: 'AIRSIDE ICT Maintenance and Support Services (2026-2027) - Letter of Award' },
  { label: 'For and on behalf of', value: 'New Charm Management Limited Nr' },
  { label: 'Service Period', value: '1 May 2026 to 30 Apr 2027 (Both dates inclusive)' },
  { label: 'Contract Sum', value: 'HK$6,137,434.00' },
  { label: 'Service Content', value: 'For details of the contract terms and conditions, please refer to the' },
  { label: 'Payment Terms', value: 'in RFP for AIRSIDE ICT Maintenance and Support Services.' },
];
const award = app.mapDetectedFields(AWARD, null, '');

// The amount. An award letter states its total as a Contract Sum, which is a
// third spelling on top of the ATQ's "Total Value of Quotation (HKD)" and a
// vendor's "Total Amount (HK$)" -- and the one the reviewer most wants to see
// against the ATQ, since a letter of award IS the number being agreed to.
// The value keeps the currency the document printed -- mapDetectedFields hands
// back what the label said, and normAmount is what makes "HK$6,137,434.00" and
// "6137434" compare equal later. (Only the text readers strip it, because they
// had to recognise the currency to be allowed to read the line at all.)
eq('an award letter\'s Contract Sum is the HKD amount', award.hkd, 'HK$6,137,434.00');

// The period. This half already worked the moment the row reached the App at
// all -- splitPeriodRange reads "to" as a separator and drops the parenthetical
// -- which is worth pinning precisely because nothing App-side had to change.
eq('a Service Period fills the start date', award.startDate, '1 May 2026');
eq('...and the end date', award.endDate, '30 Apr 2027');
eq('"(Both dates inclusive)" is not part of the end date',
  JSON.stringify(app.splitPeriodRange('1 May 2026 to 30 Apr 2027 (Both dates inclusive)')),
  JSON.stringify({ start: '1 May 2026', end: '30 Apr 2027' }));

// The anchoring that keeps "Contract Sum" from widening into its neighbours.
// Same rule the other amount patterns follow: anchored at both ends, and only a
// currency marker may follow the word.
eq('"Contract Sum (HKD)" is the same label', app.mapDetectedFields(
  [{ label: 'Contract Sum (HKD)', value: 'HK$120.00' }], null).hkd, 'HK$120.00');
eq('"Contract Summary" is not an amount', app.mapDetectedFields(
  [{ label: 'Contract Summary', value: 'See appendix' }], null).hkd, undefined);
eq('"Sum Insured" is not one either', app.mapDetectedFields(
  [{ label: 'Sum Insured', value: 'HK$5,000,000.00' }], null).hkd, undefined);

/* ---------- the Agreement <-> ATQ label pairing ----------

   The reviewer works to a mapping between what each document calls a row:

     Agreement                       ATQ
     Agreement No. / Contract No.    Agreement Number / Agreement Number_New
     Customer Name                   Customer Name
     Maintenance Period (Start)      (Min) Contract Start Date_New
     Maintenance Period (End)        (Max) Contract End Date_New
     Total Charge / Amount           Contract Revenue

   Fourteen of those twenty-one spellings already mapped. These are the seven
   that did not. */

const maps = (label, value) => app.mapDetectedFields([{ label, value: value || 'X-1' }], null, '');

// "Agreement No." -- `agreement\s*number` never reached the abbreviation.
eq('"Agreement No." is the contract number', maps('Agreement No.', 'L000000000ZZ').contractNo, 'L000000000ZZ');
eq('"Agreement No" without the stop is too', maps('Agreement No', 'L000000000ZZ').contractNo, 'L000000000ZZ');
// The lookahead earns its keep here: `no\.?` alone matches the first two
// letters of "Notes", and a notes field is not a contract number.
eq('"Agreement Notes" is not', maps('Agreement Notes', 'see appendix').contractNo, undefined);

// A period arrives as ONE label holding a range, or as two labels holding a
// date each. The second form never reached the range pass at all: its value is
// a single date, so splitPeriodRange returns null and the label was dropped.
eq('"Maintenance Period (Start)" is the start date', maps('Maintenance Period (Start)', '1 Apr 2026').startDate, '1 Apr 2026');
eq('"Maintenance Period (End)" is the end date', maps('Maintenance Period (End)', '31 Mar 2027').endDate, '31 Mar 2027');
eq('the brackets are optional', maps('Maintenance Period Start', '1 Apr 2026').startDate, '1 Apr 2026');
eq('a dash separator reads too', maps('Service Period - Start', '1 Apr 2026').startDate, '1 Apr 2026');
eq('and the third period word', maps('Contract Period (End Date)', '31 Mar 2027').endDate, '31 Mar 2027');
// The bare label must NOT be caught here -- it belongs to the range pass, which
// splits one value into two dates. Anchoring on start/end after "period" is
// what keeps the two apart.
{
  const range = maps('Maintenance Period', '1 Apr 2026 - 31 Mar 2027');
  eq('a bare period still goes through the range pass', range.startDate, '1 Apr 2026');
  eq('...both halves of it', range.endDate, '31 Mar 2027');
}

// "Total Charge" (Agreement) and "Contract Revenue" (ATQ) are the same row.
eq('"Total Charge" is the amount', maps('Total Charge', '715,657.72').hkd, '715,657.72');
eq('the plural reads too', maps('Total Charges', '715,657.72').hkd, '715,657.72');
eq('"Contract Revenue" is the amount', maps('Contract Revenue', '$715,657.72').hkd, '$715,657.72');

// Measured, not defensive: a real ATQ sheet prints "Contract Revenue_New" at
// row 19 and "Contract Revenue_Previous" at row 32. The suffix is allowed on
// exactly the one that means THIS contract.
eq('"Contract Revenue_New" is this contract\'s', maps('Contract Revenue_New', '715,657.72').hkd, '715,657.72');
eq('"Contract Revenue_Previous" is the last one\'s, and is not read',
  maps('Contract Revenue_Previous', '640,000.00').hkd, undefined);
// Its neighbours in that same block, which the ^contract anchor keeps out.
['Monthly Revenue_New', 'Gross Profit_New', 'Direct Variable Cost_New',
  'Retention (MA)_Previous Contract Revenue'].forEach(label =>
  eq(JSON.stringify(label) + ' is not the contract amount', maps(label, '1,000.00').hkd, undefined));

// The currency guard. Total Charge and Total Value are each TWO Dataverse
// columns (admin_totalchargehkd2 / admin_totalchargeusd2), so a USD figure
// landing in the HKD row is a wrong value -- worse here than a missing one.
eq('"Total Charge (HKD)" is the same label', maps('Total Charge (HKD)', '715,657.72').hkd, '715,657.72');
['Total Charge (USD)', 'Contract Revenue (USD)', 'Total Value (USD)'].forEach(label =>
  eq(JSON.stringify(label) + ' stays out of the HKD row', maps(label, '92,000.00').hkd, undefined));
['Total Qty', 'Total Hours', 'Total Value of Goods Sold'].forEach(label =>
  eq(JSON.stringify(label) + ' is not an amount at all', maps(label, '12').hkd, undefined));

/* ---------- report ---------- */

if (failures.length) {
  console.error(passed + ' passed, ' + failures.length + ' failed');
  failures.forEach(f => console.error('  FAIL  ' + f));
  process.exit(1);
}
console.log(passed + ' passed, 0 failed');
