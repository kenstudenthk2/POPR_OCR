// Assertions for the Save-loop payload builder (Phase 7): buildRecordPayload.
//
//   node _test/app-harness/save.test.js
//
// No framework, same reasoning as recordid.test.js. buildRecordPayload is a
// pure function precisely so it can be tested here -- the harness has no
// parent.Xrm.WebApi, so the actual createRecord loop in goSave can only be
// exercised in a real browser.

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

// A fields object with only the keys given, in the shape App's `fields`
// state actually carries: { [key]: { value, auto } }.
function fieldsOf(values) {
  const out = {};
  Object.entries(values).forEach(([k, v]) => { out[k] = { value: v, auto: false }; });
  return out;
}

/* ---------- Record_ID lands in both admin_title and admin_prx0020reference ---------- */

const base = fieldsOf({ recordNo: 'PR-0001', customerName: 'ABC Company Ltd' });
const payload = app.buildRecordPayload(base, 'ATQ-202604-00177-2', [true, true, true, true]);
eq('admin_title takes the resolved Record_ID, not recordNo', payload.admin_title, 'ATQ-202604-00177-2');
eq('admin_prx0020reference takes the same Record_ID', payload.admin_prx0020reference, 'ATQ-202604-00177-2');
eq('other fields still map through normally', payload.admin_customerx0020name, 'ABC Company Ltd');

/* ---------- date and decimal parsing ---------- */

const withDates = fieldsOf({ recdDate: '2026-08-14', hkd: 'HKD 1,234.56' });
const datePayload = app.buildRecordPayload(withDates, 'PR-0002', [true, true, true, true]);
eq('a date field parses to YYYY-MM-DD', datePayload.admin_recx0027dx0020datex0020, '2026-08-14');
eq('a currency string parses to a plain decimal', datePayload.admin_hkd, 1234.56);

const badDate = app.buildRecordPayload(fieldsOf({ recdDate: 'not a date' }), 'PR-0003', [true, true, true, true]);
ok('an unparseable date is dropped, not written as garbage', !('admin_recx0027dx0020datex0020' in badDate));

/* ---------- buildRecordPayload: Quotation Start/End Date (LIS & Remark's
   columns P/Q) are TEXT columns on admin_quotationstartdates/admin_quotationenddates
   -- the same two Dataverse fields buildLisExcelPayload writes for the same
   reason (a quotation's own wording, "TBC", a stated period, is not an ISO
   date). Was wrongly wired to poStartDate/poEndDate through parseIsoDate,
   which silently dropped any non-ISO text and, since poStartDate/poEndDate
   have no UI in the LIS & Remark table, in practice wrote nothing at all. ---------- */

const quotationDatesPayload = app.buildRecordPayload(
  fieldsOf({ quotationStartDate: '2026-04-01', quotationEndDate: '2027-03-31', poStartDate: '2099-01-01', poEndDate: '2099-12-31' }),
  'PR-0008', [true, true, true, true]);
eq('quotationStartDate maps to admin_quotationstartdates unparsed', quotationDatesPayload.admin_quotationstartdates, '2026-04-01');
eq('quotationEndDate maps to admin_quotationenddates unparsed', quotationDatesPayload.admin_quotationenddates, '2027-03-31');
ok('poStartDate no longer lands on admin_quotationstartdates',
  quotationDatesPayload.admin_quotationstartdates !== '2099-01-01');

const quotationFreeTextDate = app.buildRecordPayload(fieldsOf({ quotationStartDate: 'TBC' }), 'PR-0009', [true, true, true, true]);
eq('a non-ISO quotation start date is kept as text, not dropped by the date sanitizer',
  quotationFreeTextDate.admin_quotationstartdates, 'TBC');

/* ---------- sanitizer: empty / missing fields never reach the payload ---------- */

const sparse = app.buildRecordPayload(fieldsOf({ customerName: 'Only This' }), 'PR-0004', [true, true, true, true]);
ok('a field with no value is not present at all', !('admin_remarks' in sparse));
ok('a field never given is not present either', !('admin_pox0020nox002e' in sparse));
ok('a value with only whitespace is not present', (() => {
  const p = app.buildRecordPayload(fieldsOf({ remarks: '   ' }), 'PR-0005', [true, true, true, true]);
  return !('admin_remarks' in p);
})());

/* ---------- manualChecks drives admin_odatacolortag ---------- */

eq('all manual checks true -> Completed',
  app.buildRecordPayload(base, 'PR-0006', [true, true, true, true]).admin_odatacolortag, 'Completed');
eq('any manual check false -> Pending',
  app.buildRecordPayload(base, 'PR-0007', [true, false, true, true]).admin_odatacolortag, 'Pending');

/* ---------- PR Amount currency saving & 1:7.9 rate conversion ---------- */

const hkdCase = fieldsOf({ hkd: '16000', currency: 'HKD' });
const hkdPayload = app.buildRecordPayload(hkdCase, 'PR-0010', [true, true, true, true]);
eq('HKD PR Amount saves number value to admin_hkd', hkdPayload.admin_hkd, 16000);
eq('currency selection HKD saves to admin_hkdusd', hkdPayload.admin_hkdusd, 'HKD');
eq('HKD PR Amount saves text value to admin_pramounthkd', hkdPayload.admin_pramounthkd, '16000');
eq('HKD PR Amount converts at 1 USD : 7.9 HKD and saves to admin_pramountusd', hkdPayload.admin_pramountusd, '2025.32');

const usdCase = fieldsOf({ hkd: '16000', currency: 'USD' });
const usdPayload = app.buildRecordPayload(usdCase, 'PR-0011', [true, true, true, true]);
eq('USD PR Amount saves number value to admin_hkd', usdPayload.admin_hkd, 16000);
eq('currency selection USD saves to admin_hkdusd', usdPayload.admin_hkdusd, 'USD');
eq('USD PR Amount saves text value to admin_pramountusd', usdPayload.admin_pramountusd, '16000');
eq('USD PR Amount converts at 1 USD : 7.9 HKD and saves to admin_pramounthkd', usdPayload.admin_pramounthkd, '126400');

/* ---------- buildLisExcelPayload: currency and converted columns on Continue to save ---------- */

const lisHkdCase = { prAmount: '16000', currency: 'HKD' };
const lisHkdPayload = app.buildLisExcelPayload(lisHkdCase, 'PR-0012');
eq('Continue to save maps admin_pramount as string for HKD', lisHkdPayload.admin_pramount, '16000');
eq('Continue to save maps admin_hkd as decimal when HKD', lisHkdPayload.admin_hkd, 16000);
eq('Continue to save leaves admin_usdx0020x002fx0020others unmapped when HKD', lisHkdPayload.admin_usdx0020x002fx0020others, undefined);
eq('Continue to save maps admin_hkdusd as text', lisHkdPayload.admin_hkdusd, 'HKD');
eq('Continue to save maps admin_pramounthkd as text', lisHkdPayload.admin_pramounthkd, '16000');
eq('Continue to save maps admin_pramountusd as text', lisHkdPayload.admin_pramountusd, '2025.32');

const lisUsdCase = { prAmount: '16000', currency: 'USD' };
const lisUsdPayload = app.buildLisExcelPayload(lisUsdCase, 'PR-0013');
eq('Continue to save maps admin_pramount as string for USD', lisUsdPayload.admin_pramount, '16000');
eq('Continue to save maps admin_usdx0020x002fx0020others when USD', lisUsdPayload.admin_usdx0020x002fx0020others, '16000');
eq('Continue to save leaves admin_hkd unmapped when USD', lisUsdPayload.admin_hkd, undefined);
eq('Continue to save maps admin_hkdusd as text for USD', lisUsdPayload.admin_hkdusd, 'USD');
eq('Continue to save maps admin_pramountusd as text for USD', lisUsdPayload.admin_pramountusd, '16000');
eq('Continue to save maps admin_pramounthkd as text for USD', lisUsdPayload.admin_pramounthkd, '126400');

/* ---------- buildAtqExcelPayload: Record_ID lands in both admin_title2 and admin_externalprimarykey ---------- */

const atqBase = fieldsOf({ contractNo: 'L260390185MZ', customerName: 'ABC Company Ltd', vendor: 'DCSS Technology' });
const atqPayload = app.buildAtqExcelPayload(atqBase, 'ATQ-202604-00177-2');
eq('admin_title2 takes the resolved Record_ID', atqPayload.admin_title2, 'ATQ-202604-00177-2');
eq('admin_externalprimarykey takes the same Record_ID', atqPayload.admin_externalprimarykey, 'ATQ-202604-00177-2');
eq('contractNo maps to admin_agreementnumber2', atqPayload.admin_agreementnumber2, 'L260390185MZ');
eq('vendor maps to admin_vendorname2', atqPayload.admin_vendorname2, 'DCSS Technology');

/* ---------- buildAtqExcelPayload: date and decimal parsing ---------- */

const atqDated = fieldsOf({ startDate: '2026-04-01', endDate: '2027-03-31', hkd: 'HKD 1,755' });
const atqDatePayload = app.buildAtqExcelPayload(atqDated, 'ATQ-202604-00177-2');
eq('startDate parses to admin_contractstartdatenew2', atqDatePayload.admin_contractstartdatenew2, '2026-04-01');
eq('endDate parses to admin_contractenddatenew2', atqDatePayload.admin_contractenddatenew2, '2027-03-31');
eq('hkd parses to a plain decimal on admin_totalvalueofquotationhkd2', atqDatePayload.admin_totalvalueofquotationhkd2, 1755);

/* ---------- buildAtqExcelPayload: sanitizer drops empty/missing fields ---------- */

const atqSparse = app.buildAtqExcelPayload(fieldsOf({ customerName: 'Only This' }), 'ATQ-202604-00177-3');
ok('a field with no value is not present at all', !('admin_vendorname2' in atqSparse));
ok('a field never given is not present either', !('admin_handleby2' in atqSparse));

/* ---------- writeAtqExcelRecord: Send to n8n creates BTB_ATQ_Excel once ---------- */

const atqWrites = [];
let markedAtqExcelWritten = false;
app.writeAtqExcelRecord(atqBase, 'ATQ-202604-00177-2', false, () => { markedAtqExcelWritten = true; }, {
  createRecord: async (entity, payload) => { atqWrites.push({ entity, payload }); },
}).then(() => {
  eq('writeAtqExcelRecord creates admin_btb_atq_excels',
    atqWrites[0] && atqWrites[0].entity, 'admin_btb_atq_excels');
  eq('writeAtqExcelRecord sends the resolved Record_ID',
    atqWrites[0] && atqWrites[0].payload && atqWrites[0].payload.admin_title2, 'ATQ-202604-00177-2');
  ok('writeAtqExcelRecord marks the row as written after createRecord succeeds', markedAtqExcelWritten);
  return app.writeAtqExcelRecord(atqBase, 'ATQ-202604-00177-2', true, () => {
    failures.push('marked already-written ATQ Excel row again');
  }, {
    createRecord: async () => { failures.push('created already-written ATQ Excel row again'); },
  });
}).then(() => {
  eq('writeAtqExcelRecord does not duplicate an already-written row', atqWrites.length, 1);
}).catch(err => {
  failures.push('writeAtqExcelRecord promise rejected\n      ' + (err && err.message));
}).then(runLisTests);

/* ---------- buildLisExcelPayload: Record_ID lands in admin_title (not admin_title2 --
   this table kept the plain schema name through the table recreation, see the
   DATAVERSE_LIS_SOURCE comment in the app) ---------- */

// Unlike buildRecordPayload/buildAtqExcelPayload, `values` here is a plain
// {key: string} map -- the Verify Table's own LIS Value column state, not the
// App's {value, auto} fields shape -- since this write happens before the
// LIS & Remark page's own fields exist.
const lisBase = { customerName: 'ABC Company Ltd', vendor: 'Cisco Systems Ltd', contractNo: 'AG-2026-004821' };
const lisPayload = app.buildLisExcelPayload(lisBase, 'ATQ-202604-00177-2');
eq('admin_title takes the resolved Record_ID', lisPayload.admin_title, 'ATQ-202604-00177-2');
eq('customerName maps to admin_customerx0020name', lisPayload.admin_customerx0020name, 'ABC Company Ltd');
eq('vendor maps to admin_vendor', lisPayload.admin_vendor, 'Cisco Systems Ltd');

/* ---------- buildLisExcelPayload: date and decimal parsing ---------- */

const lisDated = { contractStartDate: '2026-01-01', contractEndDate: '2026-12-31', prAmount: 'HKD 128,400.00' };
const lisDatePayload = app.buildLisExcelPayload(lisDated, 'ATQ-202604-00177-2');
eq('contractStartDate parses to admin_contractstartdate', lisDatePayload.admin_contractstartdate, '2026-01-01');
eq('contractEndDate parses to admin_contractenddate', lisDatePayload.admin_contractenddate, '2026-12-31');
eq('prAmount parses to a plain decimal on admin_hkd', lisDatePayload.admin_hkd, 128400);

/* ---------- buildLisExcelPayload: Quotation Start/End Date are TEXT columns,
   not Date columns -- parseIsoDate must not run on them, or a non-ISO string
   (a quotation's own wording, "TBC", a stated period) gets silently dropped
   by the sanitizer instead of showing up in the LIS & Remark table ---------- */

const lisQuotationDates = app.buildLisExcelPayload(
  { quotationStartDate: '2026-04-01', quotationEndDate: '2027-03-31' }, 'ATQ-202604-00177-2');
eq('quotationStartDate maps to admin_quotationstartdates unparsed',
  lisQuotationDates.admin_quotationstartdates, '2026-04-01');
eq('quotationEndDate maps to admin_quotationenddates unparsed',
  lisQuotationDates.admin_quotationenddates, '2027-03-31');

const lisFreeTextDate = app.buildLisExcelPayload({ quotationStartDate: 'TBC' }, 'ATQ-202604-00177-2');
eq('a non-ISO quotation start date is kept as text, not dropped by the date sanitizer',
  lisFreeTextDate.admin_quotationstartdates, 'TBC');

/* ---------- buildLisExcelPayload: sanitizer drops empty/missing fields ---------- */

const lisSparse = app.buildLisExcelPayload({ customerName: 'Only This' }, 'ATQ-202604-00177-3');
ok('a field with no value is not present at all', !('admin_vendor' in lisSparse));
ok('a field never given is not present either', !('admin_handledx0020byx0020' in lisSparse));

/* ---------- writeLisExcelRecord: "Continue to save" on the Verify Table creates
   BTB_LIS_Excel_Datas once. Pinned against DATAVERSE_LIS_SOURCE.entity -- the
   table the page reads back from -- because a typo here means the write lands
   somewhere the reviewer never looks, or nowhere at all, while the button
   still reports success. ---------- */

const lisWrites = [];
let markedLisWritten = false;
function runLisTests() {
  return app.writeLisExcelRecord(lisBase, 'ATQ-202604-00177-2', false, () => { markedLisWritten = true; }, {
    createRecord: async (entity, payload) => { lisWrites.push({ entity, payload }); },
  }).then(err => {
    ok('writeLisExcelRecord reports no error on success', !err, err);
    eq('writeLisExcelRecord writes to the same entity the Verify Table reads from (DATAVERSE_LIS_SOURCE.entity)',
      lisWrites[0] && lisWrites[0].entity, app.DATAVERSE_LIS_SOURCE.entity);
    eq('writeLisExcelRecord sends the resolved Record_ID',
      lisWrites[0] && lisWrites[0].payload && lisWrites[0].payload.admin_title, 'ATQ-202604-00177-2');
    ok('writeLisExcelRecord marks the row as written after createRecord succeeds', markedLisWritten);
    return app.writeLisExcelRecord(lisBase, 'ATQ-202604-00177-2', true, () => {
      failures.push('marked an already-written LIS row as written again');
    }, {
      createRecord: async () => { failures.push('created already-written LIS row again'); },
    });
  }).then(() => {
    eq('writeLisExcelRecord does not duplicate an already-written row', lisWrites.length, 1);
    return runLisExistingTests();
  }).catch(err => {
    failures.push('writeLisExcelRecord promise rejected\n      ' + (err && err.message));
    finish();
  });
}

/* ---------- findExistingLisRecordId: checked before every "Continue to save"
   write so a Record_ID saved in an earlier session (lisExcelWritten resets on
   reload) gets an update prompt instead of a second create hitting whatever
   the connector's own uniqueness handling does with that -- see CLAUDE.md /
   the "ISV 程式碼中發生未預期的錯誤" incident this was written for. ---------- */

async function runLisExistingTests() {
  eq('no webApi -> no existence check possible, treated as not found',
    await app.findExistingLisRecordId('ATQ-202604-00177-2', undefined), null);
  eq('no recordId -> not found without even querying',
    await app.findExistingLisRecordId('', { retrieveMultipleRecords: async () => { failures.push('queried with no recordId'); return { entities: [] }; } }), null);

  eq('no matching row -> null',
    await app.findExistingLisRecordId('ATQ-202604-00177-9', {
      retrieveMultipleRecords: async () => ({ entities: [] }),
    }), null);

  eq('a matching row carrying its own id column -> that GUID',
    await app.findExistingLisRecordId('ATQ-202604-00177-2', {
      retrieveMultipleRecords: async (entity, query) => {
        eq('queries the same entity writeLisExcelRecord writes to', entity, app.DATAVERSE_LIS_SOURCE.entity);
        ok('filters on the Record_ID', query.indexOf("ATQ-202604-00177-2") !== -1, query);
        return { entities: [{ admin_btb_lis_excel_datasid: 'guid-123', admin_title: 'ATQ-202604-00177-2' }] };
      },
    }), 'guid-123');

  eq('a matching row with no resolvable id column -> "" (found, but unsafe to update)',
    await app.findExistingLisRecordId('ATQ-202604-00177-2', {
      retrieveMultipleRecords: async () => ({ entities: [{ admin_title: 'ATQ-202604-00177-2' }] }),
    }), '');

  /* ---------- writeLisExcelRecord: an existingId updates that row instead of creating a new one ---------- */

  const updateCalls = [];
  const errFromUpdate = await app.writeLisExcelRecord(lisBase, 'ATQ-202604-00177-2', false, () => {}, {
    createRecord: async () => { failures.push('createRecord called when an existingId was given'); },
    updateRecord: async (entity, id, payload) => { updateCalls.push({ entity, id, payload }); },
  }, 'guid-123');
  ok('writeLisExcelRecord with an existingId reports no error on success', !errFromUpdate, errFromUpdate);
  eq('writeLisExcelRecord updates the same entity, not a different one',
    updateCalls[0] && updateCalls[0].entity, 'admin_btb_lis_excel_datas');
  eq('writeLisExcelRecord updates the row findExistingLisRecordId found',
    updateCalls[0] && updateCalls[0].id, 'guid-123');
  eq('writeLisExcelRecord still sends the resolved Record_ID on update',
    updateCalls[0] && updateCalls[0].payload && updateCalls[0].payload.admin_title, 'ATQ-202604-00177-2');

  finish();
}

/* ---------- the Verify Table's LIS Value column reaches LIS & Remark ---------- */

// Reported from a real run: the reviewer changed the Vendor LIS Value from
// "NEXUS2S" to "NEXUS2S Asia Limited", pressed "Continue to save", and the LIS
// & Remark page still showed "NEXUS2S".
//
// `goLis(lisExcelValues())` carried the new value across as `lisRowValues`, but
// LisRemarkPage's `valueOf` reads `fields[key].value` FIRST and only falls back
// to lisRowValues -- and `fields.vendor` was already filled by detectFromRoles
// during Process with the document's own reading. So the stale auto-extracted
// value won over the reviewer's explicit choice, on the page and (via
// buildRecordPayload) in the Save.
//
// seedFieldsFromLisRows is the pure half of the fix: the reviewer's column
// beats an auto-extracted field, and never an edit they made themselves.

// `lisRowValues` is keyed by VERIFY_TABLE_ROWS **id**, `fields` by field key,
// and the two genuinely differ -- LIS_ROW_TO_FIELD_KEY is what bridges them.
eq('the LIS row ids map onto field keys, not onto themselves',
  app.LIS_ROW_TO_FIELD_KEY.prAmount, 'hkd');
eq('...and the contract dates are startDate/endDate, not their own row ids',
  app.LIS_ROW_TO_FIELD_KEY.contractStartDate + '/' + app.LIS_ROW_TO_FIELD_KEY.contractEndDate,
  'startDate/endDate');
// The quotation dates are the trap: their ROW key is `startDate` (they share
// the contract's crosscheck bucket) while their FORM field is their own. Taking
// row.key here would write the quotation's dates into the contract's boxes.
eq("...and the quotation dates keep their own fields, not the contract's",
  app.LIS_ROW_TO_FIELD_KEY.quotationStartDate, 'quotationStartDate');
eq('Back-to-Back is deliberately not seeded into the yn field',
  app.LIS_ROW_TO_FIELD_KEY.yn, undefined);

{
  const fields = {
    vendor: { value: 'NEXUS2S', auto: true },          // detectFromRoles' reading
    customerName: { value: 'ABC Company Ltd', auto: true },
    hkd: { value: '', auto: true },
    startDate: { value: '2026-01-01', auto: false },   // the reviewer typed this
  };
  const rows = { vendor: 'NEXUS2S Asia Limited', customerName: 'ABC Company Ltd',
    prAmount: '132,800.00', contractStartDate: '2026-04-01' };
  const next = app.seedFieldsFromLisRows(fields, rows);

  eq("the reviewer's LIS Value replaces the auto-extracted one",
    next.vendor.value, 'NEXUS2S Asia Limited');
  eq('...and a blank field is filled from it too', next.hkd.value, '132,800.00');
  eq("...but a field the reviewer edited by hand is left alone",
    next.startDate.value, '2026-01-01');
  eq('a seeded value stays flagged auto, so a later edit still wins',
    next.vendor.auto, true);
  eq('a field no LIS row names is untouched', next.customerName.value, 'ABC Company Ltd');

  // Not mutated in place: this feeds setFields(prev => ...), where React
  // compares the object it gets back against the one it held.
  eq('the fields object handed in is not mutated', fields.vendor.value, 'NEXUS2S');
  ok('a new object is returned', next !== fields);
}

{
  // A blank LIS Value is not an instruction to blank the form. The column is
  // empty for every row the reviewer never touched and every row no document
  // filled, so writing those through would wipe fields that are correct.
  const fields = { vendor: { value: 'NEXUS2S', auto: true } };
  const next = app.seedFieldsFromLisRows(fields, { vendor: '' });
  eq('an empty LIS Value does not blank the field', next.vendor.value, 'NEXUS2S');
}

eq('no rows at all is a no-op', app.seedFieldsFromLisRows({ a: { value: '1', auto: true } }, null).a.value, '1');

/* ---------- report ---------- */


function finish() {
  console.log(passed + ' passed, ' + failures.length + ' failed');
  if (failures.length) {
    failures.forEach(f => console.log('  FAIL  ' + f));
    process.exit(1);
  }
}
