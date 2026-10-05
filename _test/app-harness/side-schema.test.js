// One file, two web resources: which side this copy is running as, and the
// two separate Dataverse schemas behind that. See CLAUDE.md, "One file, two
// web resources".
//
//   node _test/app-harness/side-schema.test.js
//
// The harness has no `location`, so SIDE itself resolves to null here -- that
// is the unrecognised case, and it is asserted rather than worked around.
// resolveSide is exported precisely so the two real URLs can be pinned
// without a browser.
const { load } = require('./app.js');

const app = load();
let pass = 0, fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; return; }
  fail++;
  console.log('FAIL: ' + msg);
}
function eq(actual, expected, msg) {
  ok(actual === expected, msg + '\n  expected: ' + JSON.stringify(expected) + '\n  actual:   ' + JSON.stringify(actual));
}

const { resolveSide, SIDE, SIDE_READY, IS_ADMIN, SIDE_LABEL,
        DATAVERSE_SCHEMAS, SCHEMA, mapPayload, FEATURES,
        buildRecordPayload, buildLisExcelPayload, buildLisStartPayload, btbTypeOf,
        buildAtqExcelPayload, VERIFY_TABLE_ROWS_ALL, VERIFY_TABLE_ROWS,
  normCodeKey, pairCodesFromLookup, localIsoDay } = app;

/* ---------- 1. the three real web resource URLs ---------- */
// Taken verbatim from the deployed URLs. Note the Admin one carries NO .html
// extension while the dev one does -- a pattern keyed on the extension would
// read one of them wrong.
eq(resolveSide('/WebResources/admin_PRAssistant.html', ''), 'dev',
  'the dev web resource resolves to dev');
eq(resolveSide('/WebResources/admin_PRAssistantApp_Admin', ''), 'admin',
  'the Admin web resource, which has no .html extension, resolves to admin');

// The third resource normally serves a different FILE -- the standalone
// "PR Assistant App_MasterRecords.html" -- but the lookup answers for a NAME.
// That page reads and writes the dev tables' columns unconditionally, so this
// file opened at that name must answer "dev" and not null: null would leave a
// reviewer comparing the embedded Master Records step against the standalone
// page with an app that silently refuses every write.
eq(resolveSide('/WebResources/admin_MasterRecords.html', ''), 'dev',
  'the Master Records web resource resolves to dev');
eq(resolveSide('/webresources/ADMIN_MASTERRECORDS', ''), 'dev',
  'the Master Records resource resolves without its .html extension too');

// Case is not the reviewer's to get right -- Dataverse serves the name as
// authored, and the lookup lowercases before matching.
eq(resolveSide('/webresources/ADMIN_PRASSISTANTAPP_ADMIN', ''), 'admin',
  'the lookup is case-insensitive');

/* ---------- 2. an unrecognised resource refuses, it does not guess ---------- */
// This is the whole reason SIDE_BY_RESOURCE is a lookup and not a /_admin$/
// pattern: a renamed or newly added resource must not fall through to "dev"
// and write the Admin app's rows into the dev tables.
eq(resolveSide('/WebResources/admin_PRAssistantApp_Uat', ''), null,
  'an unknown web resource resolves to null, not to a guessed side');
eq(resolveSide('/WebResources/some_other_thing.html', ''), null,
  'an unrelated web resource resolves to null');
eq(resolveSide('', ''), null, 'no path at all resolves to null');

// A name that merely CONTAINS the other side's spelling must not be taken for
// it -- the prefix of every resource here is itself "admin_".
eq(resolveSide('/WebResources/admin_PRAssistant_Something.html', ''), null,
  'a resource whose name starts with admin_ is not therefore the Admin side');

/* ---------- 3. ?side= overrides, including on a recognised resource ---------- */
eq(resolveSide('/WebResources/admin_PRAssistant.html', '?side=admin'), 'admin',
  '?side=admin overrides a recognised dev resource');
eq(resolveSide('/WebResources/admin_PRAssistantApp_Admin', '?side=dev'), 'dev',
  '?side=dev overrides a recognised Admin resource');
eq(resolveSide('/WebResources/nothing_known', '?side=admin'), 'admin',
  '?side= also rescues an unrecognised resource');
eq(resolveSide('/WebResources/admin_PRAssistant.html', '?side=uat'), 'dev',
  'an unrecognised ?side= value is ignored, not honoured');
eq(resolveSide('/WebResources/nothing_known', '?side=uat'), null,
  'an unrecognised ?side= value does not rescue an unrecognised resource either');

/* ---------- 4. under Node there is no location: the refusing state ---------- */
eq(SIDE, null, 'the harness has no location, so SIDE is null');
eq(SIDE_READY, false, 'SIDE_READY is false with no side resolved');
eq(IS_ADMIN, false, 'IS_ADMIN is false with no side resolved');
eq(SIDE_LABEL, 'UNKNOWN', 'the label says UNKNOWN rather than naming a side');
// Reads still need a schema to point at, so SCHEMA falls back to dev -- it is
// the WRITES that refuse, via SIDE_READY, not the schema that goes missing.
ok(SCHEMA === DATAVERSE_SCHEMAS.dev, 'SCHEMA falls back to dev so reads keep working');
eq(FEATURES.processStatus, false, 'the Admin-only process status feature is off on the dev side');

/* ---------- 4b. the Verify Table's three code rows are dev-only ---------- */
// Charge CCC / Account Code / Works Order Code sit directly under IPT Unit Mgr
// on the dev side and are absent from the Admin rail's Verify Table. Both
// halves matter and each fails silently on its own: a row left on Admin would
// draw a box over a column the Admin payload never writes, and an id left in
// LIS_EXCEL_ROW_IDS with no row would send an empty key for a row nobody saw.
// Issue By joined them on 2026-09-25 and is in PAIR_ROW_IDS below rather than
// here, for one reason: its LIS column, admin_issuex0020by, is spelled the SAME
// on both sides, so the "two sides share no spelling" loop further down is
// genuinely false for it. Everything the three share WITH it is checked over
// PAIR_ROW_IDS; only the spelling rule stays on these three.
const CODE_ROW_IDS = ['chargeCcc', 'accountCode', 'worksOrderCode'];
const PAIR_ROW_IDS = CODE_ROW_IDS.concat(['issueBy']);
eq(FEATURES.verifyLisCodes, true, 'the dev-only Verify Table code rows are on when the side is not admin');
eq(FEATURES.prAmountCurrency, true, 'PR Amount currency format is on for dev side');
PAIR_ROW_IDS.forEach(id => {
  const row = VERIFY_TABLE_ROWS_ALL.find(r => r.id === id);
  ok(!!row, id + ' is a VERIFY_TABLE_ROWS_ALL row');
  ok(row && row.devOnly === true, id + ' is marked devOnly');
  // lisOnly, NOT solo: no document on these emails states a charge code, so a
  // Value (ATQ Excel) cell would read "not extracted" forever. See the row's
  // own note in PR Assistant App.html.
  ok(row && row.lisOnly === true, id + ' draws the LIS box alone (lisOnly)');
  ok(row && !row.lisAutoFill, id + ' has nothing to prefill from, so no lisAutoFill');
  // The row's key is what lisCellValue looks up, so it must be a key this
  // table's fields map actually names -- on BOTH sides, since the filter is
  // what keeps the rows off Admin, not a missing column.
  ['dev', 'admin'].forEach(side => {
    ok(!!DATAVERSE_SCHEMAS[side].lis.fields[id],
      side + '.lis.fields names a column for ' + id);
    ok(DATAVERSE_SCHEMAS[side].lis.select.indexOf(DATAVERSE_SCHEMAS[side].lis.fields[id]) !== -1,
      side + '.lis.select asks for ' + id + "'s column");
  });
  // The dev write map gained chargeCcc/accountCode with these rows,
  // issueBy when Pair started filling it; worksOrderCode was already there.
  // This is the assertion that caught issueBy being read-only on dev: Pair
  // filled the box, the box showed the name, and mapPayload dropped the key.
  ok(!!DATAVERSE_SCHEMAS.dev.lis.write[id], 'dev.lis.write names a column for ' + id);
});
// Same rule as every other column in this file: nothing is derived, and the
// two sides share no spelling.
CODE_ROW_IDS.forEach(id => {
  ok(DATAVERSE_SCHEMAS.dev.lis.fields[id] !== DATAVERSE_SCHEMAS.admin.lis.fields[id],
    id + " spells its column differently on the two sides");
});
// Filtered ONCE. With the flag on, the filtered list is the whole list; the
// assertion that matters is that the filter is the only thing standing between
// them, so a second filter elsewhere would show up as a length change here.
eq(VERIFY_TABLE_ROWS.length, VERIFY_TABLE_ROWS_ALL.length,
  'with verifyLisCodes on, every row reaches the table');
eq(VERIFY_TABLE_ROWS_ALL.filter(r => r.devOnly).length, PAIR_ROW_IDS.length,
  "the four rows Pair fills are the only devOnly Verify Table rows");
// Directly under IPT Unit Mgr, which is what was asked for -- and above UID,
// which has always been last.
eq(VERIFY_TABLE_ROWS_ALL.findIndex(r => r.id === 'chargeCcc'),
  VERIFY_TABLE_ROWS_ALL.findIndex(r => r.id === 'iptUnitMgr') + 1,
  'Charge CCC sits directly below IPT Unit Mgr');
eq(VERIFY_TABLE_ROWS_ALL.map(r => r.id).slice(-5).join(','),
  'chargeCcc,accountCode,worksOrderCode,issueBy,uid',
  'the four rows Pair fills sit between IPT Unit Mgr and UID, in the order asked for');
// The write half. A blank is dropped rather than blanking a column somebody
// filled in elsewhere, and a code is Text -- "0012" must survive as "0012".
eq(JSON.stringify(buildLisExcelPayload({ chargeCcc: 'CCC-01', accountCode: '0012', worksOrderCode: 'WO-9' }, 'R-1')),
  JSON.stringify({
    [DATAVERSE_SCHEMAS.dev.lis.write.recordId]: 'R-1',
    [DATAVERSE_SCHEMAS.dev.lis.write.chargeCcc]: 'CCC-01',
    [DATAVERSE_SCHEMAS.dev.lis.write.accountCode]: '0012',
    [DATAVERSE_SCHEMAS.dev.lis.write.worksOrderCode]: 'WO-9',
  }),
  'the three codes are written as Text, leading zeros and all');
eq(JSON.stringify(buildLisExcelPayload({ chargeCcc: '', accountCode: '  ' }, 'R-1')),
  JSON.stringify({ [DATAVERSE_SCHEMAS.dev.lis.write.recordId]: 'R-1' }),
  'a blank code writes nothing rather than blanking the column');

/* ---------- 4c. the Product Type -> coding lookup behind "Pair" ---------- */
// FEATURES.verifyCodePair, and the one thing that makes it safe on the side it
// is NOT on: the Admin schema has no cccLookup at all, so there is no entity
// name to query and no guessed column to send.
ok(FEATURES.verifyCodePair === true, 'the Pair button is on for the dev side');
ok(!!DATAVERSE_SCHEMAS.dev.cccLookup, 'the dev side names a coding table');
ok(!DATAVERSE_SCHEMAS.admin.cccLookup,
  'the Admin side names NO coding table -- its columns have not been transcribed');
// Read-only, and asserted as such. A `write` map appearing here is how this
// app would start editing procurement's own reference table.
ok(!DATAVERSE_SCHEMAS.dev.cccLookup.write,
  'the coding table has no write map -- this app only ever reads it');
ok(!DATAVERSE_SCHEMAS.dev.cccLookup.records,
  'the coding table has no records map -- it is not a Master Records source');
// The same select/fields rule every other entity is held to: a selected column
// nothing names fails the WHOLE query, not just that column.
const CCC = DATAVERSE_SCHEMAS.dev.cccLookup;
const cccNamed = new Set(Object.values(CCC.fields));
CCC.select.forEach(col => {
  ok(cccNamed.has(col), 'cccLookup: selected column ' + col + ' is named in fields');
});
['productType', 'chargeCcc', 'accountCode', 'worksOrderCode', 'issueBy', 'description'].forEach(k => {
  ok(typeof CCC.fields[k] === 'string' && CCC.fields[k],
    'cccLookup.fields names a column for ' + k);
  ok(CCC.select.indexOf(CCC.fields[k]) !== -1,
    'cccLookup.select asks for ' + k + "'s column");
});
// `entity` is the LOGICAL name, which is what Xrm.WebApi.retrieveMultipleRecords
// takes -- not the OData entity set name. The pluralised spelling was tried
// against the live table on 2026-09-24 and rejected outright (找不到實體), so
// this is pinned as the exact string rather than left to the next reader's
// intuition: three of the four entities above end in "s" already and make the
// wrong rule look like the right one.
eq(CCC.entity, 'admin_btb_ccc_wocode_accode',
  'the coding table is named by its logical name, no plural "s"');
ok(CCC.entity !== 'admin_btb_ccc_wocode_accodes',
  '...and NOT by its OData entity set name, which does not resolve here');
// The same rule, stated where it can be checked: saveEntity is singular and
// has always worked, which is what tells the trailing "s" on the other three
// apart from a pluralisation rule.
eq(DATAVERSE_SCHEMAS.dev.saveEntity, 'admin_purchaserequest',
  'the dev saveEntity is singular -- the counter-example to "entities are plural"');

// The lookup table is a DIFFERENT table from the LIS one it fills, and its
// columns are spelled differently too -- the "2" suffix here is the lookup
// table's own, not a rule that travels.
ok(CCC.entity !== DATAVERSE_SCHEMAS.dev.lis.entity,
  'the coding table is not the LIS table');
// `issueBy` is the sharpest case of the four and the reason this list is
// checked rather than eyeballed: the SAME field key is admin_admin2 on the
// lookup table and admin_issuex0020by on the LIS row it is written into.
['chargeCcc', 'accountCode', 'worksOrderCode', 'issueBy'].forEach(k => {
  ok(CCC.fields[k] !== DATAVERSE_SCHEMAS.dev.lis.fields[k],
    k + ' is spelled differently on the lookup table than on the LIS table');
});
eq(CCC.fields.issueBy, 'admin_admin2', "the lookup table's Admin column");
eq(DATAVERSE_SCHEMAS.dev.lis.fields.issueBy, 'admin_issuex0020by',
  '...and the LIS column Pair writes it into');
eq(DATAVERSE_SCHEMAS.dev.lis.write.issueBy, 'admin_issuex0020by',
  '...which the write map names too, or "Continue to save" would drop it');

// --- normCodeKey: case and whitespace, and nothing else ---
eq(normCodeKey('  UCBV AV Equipment  '), 'ucbv av equipment', 'trims and lowercases');
eq(normCodeKey('UCBV   AV\tEquipment'), 'ucbv av equipment', 'collapses internal whitespace runs');
eq(normCodeKey(null), '', 'null is the empty key');
eq(normCodeKey(undefined), '', 'undefined is the empty key');
// It must NOT normalise anything else away: two product types that differ by a
// hyphen or a digit are two product types.
ok(normCodeKey('Type-A') !== normCodeKey('TypeA'), 'a hyphen still tells two types apart');
ok(normCodeKey('Logger 2') !== normCodeKey('Logger 3'), 'a digit still tells two types apart');

// --- pairCodesFromLookup ---
const F = CCC.fields;
const row = (pt, ccc, acc, wo, admin, desc) => ({
  [F.productType]: pt, [F.chargeCcc]: ccc, [F.accountCode]: acc, [F.worksOrderCode]: wo,
  [F.issueBy]: admin === undefined ? '' : admin,
  [F.description]: desc === undefined ? '' : desc,
});
const ROWS = [
  row('UCBV AV Equipment', 'CCC-01', '0012', 'WO-100', 'Chan, Mary', 'Maintenance of UCBV'),
  row('  ucbv   av equipment ', 'CCC-01', '0012', 'WO-200', 'Chan, Mary', 'Audio Visual Support'),
  row('Logger', 'CCC-77', '0099', 'WO-900', 'Lee, Peter', 'Logger Support'),
];
const many = pairCodesFromLookup(ROWS, 'ucbv av EQUIPMENT', F);
ok(!!many, 'a Product Type in the table is found, case and spacing ignored');
eq(many.chargeCcc, 'CCC-01', 'Charge CCC comes from the matched rows');
eq(many.accountCode, '0012', 'Account Code comes from the matched rows');
// Issue By is filled straight away like the two above, not offered as a list.
eq(many.issueBy, 'Chan, Mary', 'Issue By comes from the matched rows');
eq(many.worksOrderCodes.join(','), 'WO-100,WO-200',
  'every Works Order Code the Product Type allows is offered, in table order');
eq(many.worksOrderOptions.length, 2, 'worksOrderOptions has both options');
eq(many.worksOrderOptions[0].description, 'Maintenance of UCBV', 'worksOrderOptions has description for WO-100');
eq(many.worksOrderOptions[1].description, 'Audio Visual Support', 'worksOrderOptions has description for WO-200');
ok(many.conflict === false, 'rows that agree on CCC/Account Code raise no conflict');
// A leading zero is a character of the code, not a number to be tidied.
const one = pairCodesFromLookup(ROWS, 'Logger', F);
eq(one.worksOrderCodes.join(','), 'WO-900', 'a single Works Order Code is still a list of one');
eq(one.accountCode, '0099', 'an account code keeps its leading zeros');
// Not found is null, and that is NOT the same as found-but-blank: the button
// says something different for each.
eq(pairCodesFromLookup(ROWS, 'Nothing Like This', F), null, 'an uncoded Product Type is null');
eq(pairCodesFromLookup(ROWS, '   ', F), null, 'a blank Product Type is null, not a match on blank rows');
eq(pairCodesFromLookup([], 'Logger', F), null, 'an empty table is null');
eq(pairCodesFromLookup(null, 'Logger', F), null, 'no rows at all is null, not a throw');
const blank = pairCodesFromLookup([row('Bare', '', '', '')], 'Bare', F);
ok(blank !== null, 'a row that matched but codes nothing is a RESULT, not a miss');
eq(blank.chargeCcc, '', 'a blank code reads back as blank');
eq(blank.worksOrderCodes.length, 0, 'a blank works order offers no option');
// The rule the table is supposed to hold to is CHECKED, not trusted -- a table
// that broke it would otherwise pair one row's CCC with another row's works
// order, a combination that exists nowhere in it.
const bad = pairCodesFromLookup([
  row('Split', 'CCC-01', '0012', 'WO-1'),
  row('Split', 'CCC-02', '0012', 'WO-2'),
], 'Split', F);
ok(bad.conflict === true, 'rows disagreeing on Charge CCC are reported, not silently resolved');
// Issue By is inside the same check, or a table listing two Admins for one
// Product Type would have Pair fill one of them with nothing on screen saying
// the other exists.
const badAdmin = pairCodesFromLookup([
  row('Two Admins', 'CCC-01', '0012', 'WO-1', 'Chan, Mary'),
  row('Two Admins', 'CCC-01', '0012', 'WO-2', 'Lee, Peter'),
], 'Two Admins', F);
ok(badAdmin.conflict === true, 'rows disagreeing on Issue By are reported too');
eq(badAdmin.issueBy, 'Chan, Mary', '...and the first row still wins, to be checked');
const blankAdmin = pairCodesFromLookup([row('No Admin', 'CCC-01', '0012', 'WO-1', '')], 'No Admin', F);
eq(blankAdmin.issueBy, '', 'a row that codes no Admin reads back blank, not a miss');
ok(blankAdmin.conflict === false, '...and a single blank Admin is no conflict');
eq(bad.chargeCcc, 'CCC-01', 'the first row still wins so the reviewer has something to check');
eq(bad.matchedCount, 2, 'the conflict says how many rows it is about');

/* ---------- 5. the two schemas are separate, and shaped alike ---------- */
const SIDES = ['dev', 'admin'];
SIDES.forEach(side => {
  const S = DATAVERSE_SCHEMAS[side];
  ok(!!S, side + ' schema exists');
  ['agreement', 'quotation', 'lis', 'atqExcel'].forEach(k => {
    ok(!!S[k], side + '.' + k + ' exists');
    ok(typeof S[k].entity === 'string' && S[k].entity, side + '.' + k + ' names an entity');
    ok(typeof S[k].titleField === 'string' && S[k].titleField, side + '.' + k + ' names a titleField');
    ok(Array.isArray(S[k].select) && S[k].select.length, side + '.' + k + ' has a select list');
    ok(S[k].fields && Object.keys(S[k].fields).length, side + '.' + k + ' has a fields map');
  });
  ok(typeof S.saveEntity === 'string' && S.saveEntity, side + ' names a saveEntity');
  ok(S.lis.write && S.lis.records, side + '.lis has both a write and a records map');
  ok(S.atqExcel.write, side + '.atqExcel has a write map');

  // Every column the query asks for must be one this side actually names,
  // or the OData call references a column that does not exist and the whole
  // read fails -- which is how the Verify Table went blank before.
  ['agreement', 'quotation', 'lis', 'atqExcel'].forEach(k => {
    const named = new Set(Object.values(S[k].fields).concat([S[k].titleField]));
    S[k].select.forEach(col => {
      ok(named.has(col), side + '.' + k + ': selected column ' + col + ' is named in fields or titleField');
    });
  });
});

/* ---------- 6. the tables must not be mixed up ---------- */
// The one guarantee the whole arrangement rests on: nothing the dev side
// writes may land on an Admin table, and vice versa. Entities are the coarse
// check -- no entity name may appear on both sides.
const devEntities = new Set(['agreement', 'quotation', 'lis', 'atqExcel']
  .map(k => DATAVERSE_SCHEMAS.dev[k].entity).concat([DATAVERSE_SCHEMAS.dev.saveEntity]));
const adminEntities = new Set(['agreement', 'quotation', 'lis', 'atqExcel']
  .map(k => DATAVERSE_SCHEMAS.admin[k].entity).concat([DATAVERSE_SCHEMAS.admin.saveEntity]));
[...devEntities].forEach(e => {
  ok(!adminEntities.has(e), 'dev entity ' + e + ' is not also an Admin entity');
});
// Five on dev, four on Admin, and the difference is the point: the dev flow
// still creates a separate admin_purchaserequest row on Save, while the Admin
// flow finishes the LIS row "Continue to save" already created -- so its
// saveEntity IS its lis.entity. Unifying the two flows would change this
// count, which is exactly the kind of change that should not happen quietly.
eq(devEntities.size, 5, 'the dev side saves to a fifth table of its own');
eq(adminEntities.size, 4, 'the Admin side saves back into its own LIS table');
eq(DATAVERSE_SCHEMAS.admin.saveEntity, DATAVERSE_SCHEMAS.admin.lis.entity,
  'the Admin saveEntity is its LIS table');
ok(DATAVERSE_SCHEMAS.dev.saveEntity !== DATAVERSE_SCHEMAS.dev.lis.entity,
  'the dev saveEntity is a different table from its LIS table');

/* ---------- 7. the semantic split the two sides genuinely disagree on ---------- */
// "No." and "PR No." used to share ONE column on the dev tables while the
// Admin tables kept them apart. The dev LIS table's 2026-09-18 rebuild gave
// it both, so both sides now split them -- but the two sides still spell the
// pair completely differently, which is why these maps stay keyed by field
// key and are transcribed per side rather than derived from one another.
for (const side of ['dev', 'admin']) {
  const write = DATAVERSE_SCHEMAS[side].lis.write;
  ok(!!write.prNo, 'the ' + side + ' side has a separate PR No. write column');
  ok(!!write.recordNo, 'the ' + side + ' side has a No. write column');
  ok(write.recordNo !== write.prNo,
    'on the ' + side + ' side No. and PR No. are two different columns');
}
ok(DATAVERSE_SCHEMAS.dev.lis.write.prNo !== DATAVERSE_SCHEMAS.admin.lis.write.prNo,
  'the two sides spell PR No. differently');
// The Admin-only status columns, which the dev tables have at all.
ok(!DATAVERSE_SCHEMAS.dev.lis.write.processStatus && !DATAVERSE_SCHEMAS.dev.lis.write.statusRemark,
  'the dev tables have neither process status nor status remark columns');
ok(!!DATAVERSE_SCHEMAS.admin.lis.write.processStatus && !!DATAVERSE_SCHEMAS.admin.lis.write.statusRemark,
  'the Admin tables have both');

/* ---------- 8. mapPayload drops what this side has no column for ---------- */
const cols = { a: 'admin_a', b: 'admin_b' };
eq(JSON.stringify(mapPayload(cols, { a: 'x', b: 'y' })), JSON.stringify({ admin_a: 'x', admin_b: 'y' }),
  'mapPayload renames by field key');
eq(JSON.stringify(mapPayload(cols, { a: 'x', zzz: 'dropped' })), JSON.stringify({ admin_a: 'x' }),
  'a field key with no column on this side is dropped, not written as undefined');
ok(Object.keys(mapPayload(cols, { a: 'x', zzz: 'dropped' })).indexOf('undefined') === -1,
  'no literal "undefined" key ever reaches the payload');
eq(JSON.stringify(mapPayload(cols, { a: '', b: null })), '{}',
  'blank and null values are dropped, same as the sanitizers this replaced');
eq(JSON.stringify(mapPayload(cols, { a: 0 })), JSON.stringify({ admin_a: 0 }),
  'a real zero is kept -- it is a value, not a blank');
eq(JSON.stringify(mapPayload(null, { a: 'x' })), '{}', 'a missing column map writes nothing');
eq(JSON.stringify(mapPayload(cols, null)), '{}', 'a missing value map writes nothing');

/* ---------- 9. the builders write through whichever side is loaded ---------- */
// buildRecordPayload and friends read the module-level SCHEMA, which is dev
// under the harness. Rather than reaching into module state, check the shape
// against the dev write map directly: every key the builder emits must be a
// dev column, and none may be an Admin-only one.
const snapshot = {
  recordNo: { value: 'R-1' }, prNo: { value: 'PR-1' },
  customerName: { value: 'FUBON BANK (HONG KONG) LIMITED' },
  hkd: { value: '128,400' }, vendor: { value: 'Nice Systems BV' },
  issueBy: { value: 'someone' }, chargeCcc: { value: 'CCC' },
};
const payload = buildRecordPayload(snapshot, 'REC-1', [true, true, true]);
const devWriteCols = new Set(Object.values(DATAVERSE_SCHEMAS.dev.lis.write));
Object.keys(payload).forEach(col => {
  ok(devWriteCols.has(col), 'buildRecordPayload emits ' + col + ', a dev column');
});
// prNo was supplied and has an Admin column but no dev one -- it must have
// been dropped rather than carried across.
ok(!payload[DATAVERSE_SCHEMAS.admin.lis.write.prNo],
  'a value with no dev column is not written under the Admin column name');
// issueBy used to be in that list and is NOT any more: the dev write map
// gained admin_issuex0020by when Pair started filling it (2026-09-25), and
// that column is spelled the same on both sides. So the thing worth pinning
// here is the opposite -- it lands, and it lands on the dev map's own name.
eq(payload[DATAVERSE_SCHEMAS.dev.lis.write.issueBy], 'someone',
  'Issue By now has a dev column too, and a supplied value reaches it');
// ...and the blank case, which is what keeps Save from clobbering what Pair
// wrote. There are two writers of admin_issuex0020by on dev now: Continue to
// save (the Verify row) and Save (this builder, from the LIS & Remark form,
// whose input is Admin-only so it reads blank here). mapPayload dropping a
// blank is the only reason the second cannot erase the first.
const blankIssueBy = buildRecordPayload(
  Object.assign({}, snapshot, { issueBy: { value: '' } }), 'REC-1', [true, true, true]);
ok(!(DATAVERSE_SCHEMAS.dev.lis.write.issueBy in blankIssueBy),
  'a blank Issue By is dropped, so Save cannot blank what Pair saved');
eq(payload[DATAVERSE_SCHEMAS.dev.lis.write.recordId], 'REC-1',
  'the Record_ID still lands on the dev primary name column');
eq(payload[DATAVERSE_SCHEMAS.dev.lis.write.recordNo], 'R-1',
  'on the dev side recordNo lands on the single shared No./PR No. column');

// The other three builders, same guarantee.
const startPayload = buildLisStartPayload(snapshot, 'REC-1', 'UID-26-04-0143-10');
Object.keys(startPayload).forEach(col =>
  ok(devWriteCols.has(col), 'buildLisStartPayload emits ' + col + ', a dev column'));

// The Document Workbench's "Start" also writes the BTB case (2026-09-28, both
// sides). Two things are pinned and they are different claims:
//
//   1. the two column names are NOT the same and neither is derived from the
//      other -- admin_btbtype on dev, new_btb_type on admin. The dev side's
//      six new_ columns became admin_ ones in the 2026-09-18 rebuild and the
//      Admin table was not part of that, which is exactly the shape of
//      mistake a sweep-by-rule makes here;
//   2. btbTypeOf translates the Cost sheet's Y/N into the BTB/NON-BTB
//      vocabulary the column, the Master Records BTB chip and APPROVER_BANDS
//      all share. A raw "Y" reaching the column would not fail -- it would
//      band as NON-BTB in getDualApprovers, silently, which is why the empty
//      cases matter as much as the two real ones.
eq(DATAVERSE_SCHEMAS.dev.lis.write.btbType, 'admin_btbtype',
  'the dev Start write names the dev BTB column');
eq(DATAVERSE_SCHEMAS.admin.lis.write.btbType, 'new_btb_type',
  'the admin Start write names the admin BTB column');
ok(DATAVERSE_SCHEMAS.dev.lis.write.btbType !== DATAVERSE_SCHEMAS.admin.lis.write.btbType,
  'the two sides do not share the BTB column name');

eq(btbTypeOf('Y'), 'BTB', 'the Cost sheet Y is written as BTB');
eq(btbTypeOf('N'), 'NON-BTB', 'the Cost sheet N is written as NON-BTB');
eq(btbTypeOf(' n '), 'NON-BTB', 'and normText handles the padding and the case');
['', null, undefined, 'maybe', 'YES'].forEach(v =>
  eq(btbTypeOf(v), '', 'an unreadable Back-to-Back ' + JSON.stringify(v) + ' writes no case at all'));

// "" reaches mapPayload, which drops it -- so an unread Cost sheet leaves the
// column untouched rather than guessing a band. Asserted through the real
// builder, on both sides, because the drop is mapPayload's behaviour and not
// something btbTypeOf can promise on its own.
['dev', 'admin'].forEach(side => {
  const col = DATAVERSE_SCHEMAS[side].lis.write.btbType;
  const write = DATAVERSE_SCHEMAS[side].lis.write;
  eq(mapPayload(write, { recordId: 'REC-1', btbType: btbTypeOf('N') })[col], 'NON-BTB',
    'the ' + side + ' Start payload carries NON-BTB on ' + col);
  eq(mapPayload(write, { recordId: 'REC-1', btbType: btbTypeOf('Y') })[col], 'BTB',
    'the ' + side + ' Start payload carries BTB on ' + col);
  ok(!(col in mapPayload(write, { recordId: 'REC-1', btbType: btbTypeOf('') })),
    'an unread Back-to-Back leaves the ' + side + ' BTB column unwritten');
});

// The argument is optional and defaults to the four-value stub this always
// wrote -- the same rule every new parameter in this codebase follows, and the
// reason the three-argument call above still means what it meant.
ok(!(DATAVERSE_SCHEMAS.dev.lis.write.btbType in startPayload),
  'the three-argument call writes no BTB column, so the old stub is unchanged');

/* "Start" also stamps Rec'd Date with the day the record was created
   (2026-09-28, both sides). Three separate claims:

   1. the column is written on BOTH sides, under names that share nothing --
      admin_recx0027dx0020datex0020 on dev, the same with a trailing 4 on
      admin. Both were already in `write`, so this feature transcribes no new
      column name; what is pinned is that the payload actually reaches them.
   2. the value is a YYYY-MM-DD day, the shape buildRecordPayload already sends
      this column in -- the existing writer is what says what type it holds.
   3. it is the LOCAL day, not toISOString()'s. Hong Kong is +8, so a UTC day
      string is yesterday's for the first eight hours of every working day, and
      a record created at 09:00 would be stamped with the day before. Pinned by
      handing localIsoDay a moment whose UTC day and local day differ. */
['dev', 'admin'].forEach(side => {
  const col = DATAVERSE_SCHEMAS[side].lis.write.recdDate;
  const built = mapPayload(DATAVERSE_SCHEMAS[side].lis.write,
    { recordId: 'REC-1', recdDate: '2026-09-28' });
  ok(!!col, 'the ' + side + ' side has a Received Date column to write');
  eq(built[col], '2026-09-28', 'the ' + side + ' Start payload carries the day on ' + col);
});
ok(DATAVERSE_SCHEMAS.dev.lis.write.recdDate !== DATAVERSE_SCHEMAS.admin.lis.write.recdDate,
  'the two sides do not share the Received Date column name');

const stamped = buildLisStartPayload(snapshot, 'REC-1', 'UID-1', '', '2026-09-28');
eq(stamped[DATAVERSE_SCHEMAS.dev.lis.write.recdDate], '2026-09-28',
  'an explicit creation day is what Start writes');
ok(/^\d{4}-\d{2}-\d{2}$/.test(startPayload[DATAVERSE_SCHEMAS.dev.lis.write.recdDate]),
  'and with no day given it writes today as YYYY-MM-DD');
eq(startPayload[DATAVERSE_SCHEMAS.dev.lis.write.recdDate], localIsoDay(),
  'which is the local day, the same reading every other date on the page uses');

// 2026-09-28 22:00 UTC is already the 29th in Hong Kong. toISOString() would
// say the 28th; this is the one assertion that can tell the two apart, and it
// only holds where the harness runs at a positive offset -- so it compares
// against the local day the runtime itself reports rather than a fixed string.
const moment = new Date('2026-09-28T22:00:00Z');
eq(localIsoDay(moment),
  moment.getFullYear() + '-' + String(moment.getMonth() + 1).padStart(2, '0')
    + '-' + String(moment.getDate()).padStart(2, '0'),
  'localIsoDay reads the LOCAL calendar day, not the UTC one');
eq(localIsoDay('not a date'), null, 'an unreadable moment stamps nothing');

/* "Start" also writes ATQ no to admin_atqno and Item No to admin_itemno
   (2026-09-30, dev side only). Three separate claims:

   1. the column names exist on the dev side only -- admin_atqno and
      admin_itemno. The Admin table was not given these columns;
   2. an explicit atqNo and itemNo reach the Start payload under those columns;
   3. if atqNo is omitted, buildLisStartPayload falls back to fieldsSnapshot's
      atqRefNo;
   4. empty/omitted values leave both columns unwritten (dropped by mapPayload). */
eq(DATAVERSE_SCHEMAS.dev.lis.write.atqNo, 'admin_atqno',
  'the dev Start write names the dev ATQ no column');
eq(DATAVERSE_SCHEMAS.dev.lis.write.itemNo, 'admin_itemno',
  'the dev Start write names the dev Item No column');
ok(!DATAVERSE_SCHEMAS.admin.lis.write.atqNo,
  'the admin side has no atqNo column');
ok(!DATAVERSE_SCHEMAS.admin.lis.write.itemNo,
  'the admin side has no itemNo column');

const startPayloadWithAtqAndItem = buildLisStartPayload(
  snapshot, 'REC-1', 'UID-1', '', '2026-09-30', 'ATQ-202604-00177', '10');
eq(startPayloadWithAtqAndItem[DATAVERSE_SCHEMAS.dev.lis.write.atqNo], 'ATQ-202604-00177',
  'the dev Start payload carries the ATQ no on admin_atqno');
eq(startPayloadWithAtqAndItem[DATAVERSE_SCHEMAS.dev.lis.write.itemNo], '10',
  'the dev Start payload carries the Item No on admin_itemno');

const snapshotWithAtq = Object.assign({}, snapshot, { atqRefNo: { value: 'ATQ-202604-00999' } });
const startPayloadFromSnapshot = buildLisStartPayload(
  snapshotWithAtq, 'REC-1', 'UID-1', '', '2026-09-30', null, '2');
eq(startPayloadFromSnapshot[DATAVERSE_SCHEMAS.dev.lis.write.atqNo], 'ATQ-202604-00999',
  'the dev Start payload falls back to fieldsSnapshot.atqRefNo');
eq(startPayloadFromSnapshot[DATAVERSE_SCHEMAS.dev.lis.write.itemNo], '2',
  'and still carries the explicit Item No');

const startPayloadEmptyAtqItem = buildLisStartPayload(
  snapshot, 'REC-1', 'UID-1', '', '2026-09-30', '', '');
ok(!(DATAVERSE_SCHEMAS.dev.lis.write.atqNo in startPayloadEmptyAtqItem),
  'empty ATQ no is dropped by mapPayload');
ok(!(DATAVERSE_SCHEMAS.dev.lis.write.itemNo in startPayloadEmptyAtqItem),
  'empty Item No is dropped by mapPayload');

// Product Type and Contract Revenue are READ from BTB_ATQ_Excel and WRITTEN to
// BTB_LIS_Excel_Datas, under names that share nothing with the ones they were
// read from. Three separate things are pinned, and the third is the one that
// actually protects the feature.
//
//   1. the read side is untouched -- the Verify Table's Product Type VALUE is
//      BTB_ATQ_Excel's new_product_type. admin_producttype was briefly put
//      here on 2026-09-28 and is a column on the LIS table, not this one;
//      admin_producttype2 is a third column again, on cccLookup;
//   2. the write side names the LIS columns;
//   3. neither LIS column is readable -- absent from `fields` AND `select`.
//      That is not tidiness. lisValueForRow seeds a row as
//      `lisCellValue(...) || autoValue`, so a productType the LIS table can
//      answer for outranks the BTB_ATQ_Excel value that
//      FEATURES.verifyAtqExcelDataverseOnly made the row's only Value -- the
//      IPT Unit Mgr bug of 2026-09-25, exactly as CLAUDE.md predicted it
//      would recur. Keeping it out of `select` is what makes the ATQ Excel
//      value fall through, and is why no lisSeedPrefersValue flag is needed.
eq(DATAVERSE_SCHEMAS.dev.atqExcel.fields.productType, 'new_product_type',
  "the Verify Table's Product Type value is still read from BTB_ATQ_Excel");
eq(DATAVERSE_SCHEMAS.admin.atqExcel.fields.productType, 'new_product_type',
  '...on the Admin side too');
ok(!('contractRevenue' in DATAVERSE_SCHEMAS.dev.atqExcel.fields),
  'admin_totalrevenue is NOT an ATQ Excel read column -- it is the LIS write target');

eq(DATAVERSE_SCHEMAS.dev.lis.write.productType, 'admin_producttype',
  'Continue to save writes Product Type to the dev LIS column');
eq(DATAVERSE_SCHEMAS.dev.lis.write.totalRevenue, 'admin_totalrevenue',
  '...and Contract Revenue to admin_totalrevenue');
ok(!('productType' in DATAVERSE_SCHEMAS.admin.lis.write),
  'the Admin LIS table has no transcribed Product Type column, so mapPayload drops it there');

['productType', 'totalRevenue'].forEach(key => {
  ok(!(key in DATAVERSE_SCHEMAS.dev.lis.fields),
    key + ' is write-only on the dev LIS table, or it would outrank the ATQ Excel value on screen');
  const col = DATAVERSE_SCHEMAS.dev.lis.write[key];
  ok(!DATAVERSE_SCHEMAS.dev.lis.select.includes(col),
    col + ' is absent from the dev LIS $select, so lisCellValue cannot answer for it');
});

// One column, one key. `contractRevenue` is the Verify ROW id and reuses the
// existing `totalRevenue` SCHEMA key on purpose: two keys naming one column is
// a last-one-wins inside mapPayload, which shows up only as a value that will
// not stick.
eq(Object.keys(DATAVERSE_SCHEMAS.dev.lis.write)
    .filter(k => DATAVERSE_SCHEMAS.dev.lis.write[k] === 'admin_totalrevenue').length, 1,
  'exactly one schema key names admin_totalrevenue');

const ptPayload = buildLisExcelPayload(
  { productType: 'UCBV AV Equipment', contractRevenue: '1,234.50' }, 'REC-1');
eq(ptPayload[DATAVERSE_SCHEMAS.dev.lis.write.productType], 'UCBV AV Equipment',
  'the Product Type row lands on admin_producttype as plain text');
// TEXT, not a number. Column J is a text column on both sides (confirmed
// 2026-09-17) and buildRecordPayload writes it with a bare getVal for exactly
// that reason. This line was parseDecimal for one revision and Dataverse
// rejected the entire Continue to save -- every other field in the same
// update lost with it. Two writers of one column that disagree about its type
// means one of them always fails, so the other writer's type is pinned here
// as the specification.
eq(ptPayload[DATAVERSE_SCHEMAS.dev.lis.write.totalRevenue], '1,234.50',
  'the Contract Revenue row lands on admin_totalrevenue as TEXT, verbatim');
eq(typeof ptPayload[DATAVERSE_SCHEMAS.dev.lis.write.totalRevenue], 'string',
  "...and as a string, matching buildRecordPayload, the other writer of this column");

// The two writers agree about the type. Derived from both builders rather than
// asserted twice, so the pair cannot drift apart.
const formRevenue = buildRecordPayload(
  Object.assign({}, snapshot, { totalRevenue: { value: '1,234.50' } }), 'REC-1', [true, true, true]);
eq(typeof formRevenue[DATAVERSE_SCHEMAS.dev.lis.write.totalRevenue],
   typeof ptPayload[DATAVERSE_SCHEMAS.dev.lis.write.totalRevenue],
  'Save and Continue to save write admin_totalrevenue as the same type');

// Both dropped when blank, which is the only reason the two writers of
// admin_totalrevenue (this and buildRecordPayload's own form field) cannot
// erase each other -- the same guarantee admin_issuex0020by relies on above.
const emptyPayload = buildLisExcelPayload({ customerName: 'X' }, 'REC-1');
['productType', 'totalRevenue'].forEach(key =>
  ok(!(DATAVERSE_SCHEMAS.dev.lis.write[key] in emptyPayload),
    'a blank ' + key + ' is dropped, so Continue to save cannot blank what Save wrote'));

const lisPayload = buildLisExcelPayload(
  { customerName: 'X', vendor: 'Y', prAmount: '1,000', yn: 'N' }, 'REC-1', 'a remark');
eq(DATAVERSE_SCHEMAS.dev.lis.write.prAmount, 'admin_pramount',
  'dev Continue to save maps prAmount to admin_pramount');
eq(DATAVERSE_SCHEMAS.admin.lis.write.prAmount, 'admin_hkd4',
  'admin Continue to save maps prAmount to admin_hkd4');
Object.keys(lisPayload).forEach(col =>
  ok(devWriteCols.has(col), 'buildLisExcelPayload emits ' + col + ', a dev column'));
ok(!lisPayload[DATAVERSE_SCHEMAS.admin.lis.write.statusRemark],
  'the remark, which only the Admin tables have a column for, is dropped on the dev side');

const atqWriteCols = new Set(Object.values(DATAVERSE_SCHEMAS.dev.atqExcel.write));
const atqPayload = buildAtqExcelPayload(snapshot, 'REC-1');
Object.keys(atqPayload).forEach(col =>
  ok(atqWriteCols.has(col), 'buildAtqExcelPayload emits ' + col + ', a dev ATQ Excel column'));

/* ---------- 10. the sidebar is three steps on Admin, five on dev ---------- */
const { NAV_ITEMS_ALL, NAV_ITEMS, navReachable } = app;

eq(NAV_ITEMS_ALL.length, 5, 'both sides between them have five steps');
eq(NAV_ITEMS_ALL.map(i => i.key).join(','), 'upload,verify,lis,records,reply',
  'the full step list, in order');

// The filter NAV_ITEMS applies, re-derived here for each side -- the module's
// own NAV_ITEMS is fixed at load time by IS_ADMIN, which is false under the
// harness, so the Admin answer has to be computed rather than read.
const railFor = (isAdmin) => NAV_ITEMS_ALL.filter(item => !(item.devOnly && isAdmin));
eq(railFor(true).length, 3, 'the Admin rail shows THREE steps');
eq(railFor(true).map(i => i.key).join(','), 'upload,verify,lis',
  'the Admin rail is Upload, Verify Table, LIS & Remark');
eq(railFor(false).length, 5, 'the dev rail shows all five steps');

// Master Records and Reply are the two, and nothing else may be marked.
eq(NAV_ITEMS_ALL.filter(i => i.devOnly).map(i => i.key).join(','), 'records,reply',
  'exactly Master Records and Reply are dev-only');

// Under the harness (no side resolved, IS_ADMIN false) the rail is the dev one.
eq(NAV_ITEMS.length, 5, 'with no side resolved the rail falls back to the dev five');

// navReachable is what stops goSave moving an Admin reviewer onto a page with
// no rail entry to leave by. It must agree with the rail, not with a flag of
// its own.
ok(navReachable('upload') && navReachable('verify') && navReachable('lis'),
  'the three shared steps are reachable on either side');
eq(navReachable('records'), true, 'Master Records is reachable on the dev side');
eq(navReachable('nonsense'), false, 'a page that is not a step is not reachable');
// The rail and navReachable are one source, so this holds for any side.
NAV_ITEMS.forEach(item => ok(navReachable(item.key),
  'every step on the rail is reachable: ' + item.key));

/* ---------- 11. the per-side type scale ---------- */
// The Admin app is read by a different audience and runs larger type. Each
// size that differs is a class named fs-<dev>-<admin>, so the NAME states
// what the two rules must say -- which is what makes a typo in either rule
// findable without a browser. Read off the file as text: the harness compiles
// only the JSX block and never sees <style>.
const fs = require('fs');
const { APP_PATH } = require('./app.js');
const html = fs.readFileSync(APP_PATH, 'utf8');
const styleBlock = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));

const px = (s) => parseFloat(s.replace('_', '.'));
const tokensUsed = new Set(html.match(/\bfs-\d+(?:_\d+)?-\d+(?:_\d+)?\b/g) || []);
ok(tokensUsed.size > 0, 'the markup uses type-scale tokens at all');

// Anchored at line start: without it this also matches the tail of the
// `[data-side="admin"] .fs-x { ... }` rules, which come later in the block and
// would overwrite every base value with the Admin one.
const baseRule = {};
styleBlock.replace(/^\.(fs-[\w-]+) \{ font-size: ([\d.]+)px; \}/gm, (_, c, v) => { baseRule[c] = v; });
const adminRule = {};
styleBlock.replace(/\[data-side="admin"\] \.(fs-[\w-]+) \{ font-size: ([\d.]+)px; \}/g, (_, c, v) => { adminRule[c] = v; });

tokensUsed.forEach(cls => {
  const m = cls.match(/^fs-(\d+(?:_\d+)?)-(\d+(?:_\d+)?)$/);
  ok(!!m, cls + ' is a well-formed token name');
  if (!m) return;
  const devPx = px(m[1]), adminPx = px(m[2]);
  // The name says what each rule must be. A rule that disagrees with the name
  // is the failure this catches -- it would silently size one side wrong.
  eq(baseRule[cls], String(devPx), cls + ' base rule matches the name');
  eq(adminRule[cls], String(adminPx), cls + ' admin rule matches the name');
  ok(devPx !== adminPx, cls + ' actually differs between the sides (a token that does not is dead weight)');
  ok(adminPx > devPx, cls + ' is LARGER on the Admin side, never smaller');
});

// No orphans in either direction.
Object.keys(baseRule).forEach(c =>
  ok(tokensUsed.has(c), 'base rule ' + c + ' is used by some element'));
Object.keys(adminRule).forEach(c =>
  ok(tokensUsed.has(c), 'admin rule ' + c + ' is used by some element'));
eq(Object.keys(baseRule).length, Object.keys(adminRule).length,
  'every token has both a base and an Admin rule');

// Sizes written as clamp() carry their own prefix, because their values are
// not a px pair and a fs-<dev>-<admin> name could not state them. The name is
// therefore NOT self-checking the way the px tokens' names are, so what is
// pinned instead is that each one is declared on both sides and actually used.
const clampUsed = new Set(html.match(/\bfsc-[\w-]+\b/g) || []);
ok(clampUsed.size > 0, 'the markup uses clamp-sized tokens');
clampUsed.forEach(cls => {
  ok(new RegExp('^\\.' + cls + ' \\{ font-size: clamp\\(', 'm').test(styleBlock),
    cls + ' has a base rule');
  ok(styleBlock.includes('[data-side="admin"] .' + cls + ' { font-size: clamp('),
    cls + ' has an Admin rule');
});
(styleBlock.match(/\.(fsc-[\w-]+) \{/g) || []).forEach(m => {
  const c = m.slice(1, -2).trim();
  ok(clampUsed.has(c), 'clamp rule ' + c + ' is used by some element');
});

// The attribute the Admin rules hang off has to be stamped somewhere, or all
// of the above is inert.
ok(/document\.documentElement\.setAttribute\("data-side"/.test(html),
  'data-side is stamped on the root element');
// ...and it must fall back to a real side, not to nothing, or an unrecognised
// resource would render with no type scale selected at all.
ok(/setAttribute\("data-side", SIDE \|\| "dev"\)/.test(html),
  'an unrecognised resource still gets a readable scale (falls back to dev)');

// A token must never be left sitting next to a Tailwind size class on the
// same element: Tailwind's stylesheet loads after this one and would win.
const clashes = html.split('\n').filter(l =>
  /\bfs-\d/.test(l) && /\btext-(xs|sm|base|lg|xl|2xl|3xl)\b/.test(l));
eq(clashes.length, 0, 'no element carries both a type token and a Tailwind size class');

/* ---------- 12. the Admin side still LOOKS like App_Admin.html ---------- */
// The rules above prove each token is internally consistent. They cannot prove
// the Admin VALUES are the right ones -- for that the original file is the only
// authority, so while it is still on disk, every element is compared against it.
// Skipped (not failed) once it is deleted: the check is a migration aid, not a
// permanent dependency.
const ADMIN_SRC = require('path').join(require('path').dirname(APP_PATH), 'PR Assistant App_Admin.html');
if (!fs.existsSync(ADMIN_SRC)) {
  console.log('  (skipped: PR Assistant App_Admin.html is no longer on disk)');
} else {
  // A size is a size in EITHER spelling. The first version of this check knew
  // only text-[Npx], so every element still carrying a NAMED Tailwind size was
  // silently skipped rather than compared -- five of them were sized wrong on
  // the Admin side while this reported zero disagreements. Both spellings
  // therefore normalise to ONE placeholder, so a line that changed from
  // text-xs to text-[19px] still pairs with its twin, and both resolve to px.
  const TW = { xs: '12', sm: '14', base: '16', lg: '18', xl: '20', '2xl': '24', '3xl': '30', '4xl': '36' };
  const ANY = /\btext-(xs|sm|base|lg|xl|2xl|3xl|4xl)\b|text-\[(\d+(?:\.\d+)?)px\]/g;
  const sizesOf = (l) => {
    const out = []; let m; ANY.lastIndex = 0;
    while ((m = ANY.exec(l))) out.push(m[1] ? TW[m[1]] : m[2]);
    return out;
  };
  // leading- is scaled on the Admin side too (leading-[18px] -> leading-[21px]),
  // so it has to be blanked out of the skeleton as well. Left in, a line whose
  // line-height also changed never pairs with its twin and its FONT SIZE is
  // never compared -- which is how 15 mis-sized elements hid behind a green
  // check, counted as "no counterpart" rather than as a difference.
  const LEAD = /\bleading-\[[\d.]+px\]|\bleading-(none|tight|snug|normal|relaxed|loose|\d+)\b/g;
  const skel = (l) => l.replace(ANY, 'text-@').replace(LEAD, 'lead-@').trim();
  // AMBIGUOUS is an ORDINAL table, so it is looked up on the STRICTER skeleton
  // (sizes blanked, leading- left alone). Under the loose one, lines whose
  // line-height differs collapse into the same group and every ordinal shifts.
  const skelStrict = (l) => l.replace(ANY, 'text-@').trim();
  const asAdmin = (l) => l.replace(/fs-(\d+(?:_\d+)?)-(\d+(?:_\d+)?)/g,
    (_, d, a) => 'text-[' + a.replace('_', '.') + 'px]');
  // This merge's own type-scale rules are CSS, not elements.
  const isCss = (l) => /^\s*(\[data-side="admin"\] )?\.(fs-|text-\[)/.test(l);

  // Pairing is by skeleton, never by position: App_Admin.html carries
  // occurrences the dev file never had, so a positional walk drifts and starts
  // comparing unrelated elements. Where one skeleton's occurrences disagree
  // among themselves, the dev->admin order was read by hand off the markup
  // above each occurrence and is pinned here.
  const AMBIGUOUS = {
    '<div className="text-@ text-[#6B6B6B]" style={{fontFamily:"Newsreader, serif"}}>': [['16'], ['11'], ['11']],
    '<span className="text-@ text-[#6B6B6B]">': [['10'], ['19'], ['19']],
    '<div className="flex-1 text-@ leading-5 text-[#3D3D3D]">': [['19'], ['19'], ['13'], ['13'], ['13'], ['13']],
    // "Fields turn white once edited..." -- App_Admin.html:6483, 15px. An
    // earlier, differently-worded note (App_Admin.html:5317, 11px) has the
    // same skeleton and comes first, so first-match picks the wrong one.
    '<div className="text-@ leading-[18px] text-[#3D3D3D]" style={{fontFamily:"Newsreader, serif"}}>': [['15']],
  };

  const adminBy = new Map();
  fs.readFileSync(ADMIN_SRC, 'utf8').split('\n').forEach(l => {
    if (isCss(l) || !sizesOf(l).length) return;
    const k = skel(l);
    if (!adminBy.has(k)) adminBy.set(k, sizesOf(l));
  });

  const seen = new Map(), seenStrict = new Map();
  let matched = 0, devOnly = 0;
  const wrong = [], unpaired = [];
  html.split('\n').forEach((raw, i) => {
    if (isCss(raw)) return;
    const line = asAdmin(raw);
    const got = sizesOf(line);
    if (!got.length) return;
    const ks = skelStrict(line);
    const k = skel(line);
    const ns = seenStrict.get(ks) || 0; seenStrict.set(ks, ns + 1);
    seen.set(k, (seen.get(k) || 0) + 1);
    const want = AMBIGUOUS[ks] ? AMBIGUOUS[ks][ns] : adminBy.get(k);
    if (!want) { devOnly++; unpaired.push('line ' + (i + 1) + ': ' + raw.trim().slice(0, 100)); return; }
    if (want.join(',') === got.join(',')) matched++;
    else wrong.push('line ' + (i + 1) + ': admin renders ' + got.join(',') + 'px, App_Admin.html says ' + want.join(',') + 'px');
  });

  ok(matched > 250, 'the parity check actually compared the file (' + matched + ' elements)');
  eq(wrong.length, 0, 'every element the Admin original also has renders at its size'
    + (wrong.length ? '\n      ' + wrong.join('\n      ') : ''));
  // Whatever this check cannot pair has been resolved BY HAND against
  // App_Admin.html, and the count is pinned so a new one cannot slip in
  // unexamined. The 15 break down as:
  //   - the unrecognised-resource warning: this merge invented it, so there
  //     was nothing to measure it against (fs-10-13).
  //   - the document viewer's "Total Attachments: N" heading and the collapsed
  //     rail's vertical "Attachments": both read "Documents" in App_Admin.html,
  //     so the text differs and the pairing cannot see the twin. Read off
  //     App_Admin.html by hand -- both are text-[11px] on BOTH sides, so
  //     neither wants a token.
  //   - four chips in the document rail: App_Admin.html sizes them through a
  //     `large ?` ternary whose NON-large arm equals the dev size, so they
  //     already agree; the `large` variant itself was not ported.
  //   - eight whose Admin twin differs in some other class (a border colour,
  //     a leading-, a template literal). Each was read off App_Admin.html
  //     directly and carries the right token.
  eq(devOnly, 15, 'elements the parity check cannot pair (each resolved by hand)'
    + '\n      ' + unpaired.join('\n      '));
}

/* ---------- 13. "+ New Record" stays on both sides ---------- */
// Two of the five rail steps were taken off the Admin side, and this button
// sits right under the rail -- so "hide it too" is the easy wrong call. The
// user confirmed it stays. It is pinned here rather than left to a reading of
// the JSX, because nothing else would notice it going.
const railButton = html.slice(html.indexOf('onClick={onNewRecord}'));
const railButtonJsx = railButton.slice(0, railButton.indexOf('</button>'));
ok(railButtonJsx.includes('+ New Record'), 'the sidebar still has a New Record button');
ok(!/IS_ADMIN|devOnly|SIDE ===/.test(railButtonJsx),
  '"+ New Record" is not gated by side -- it shows on Admin as well as dev');
// And it must land somewhere the rail can highlight, on EVERY side: a jump to
// a page NAV_ITEMS hides leaves the reviewer with no step selected and no way
// back. "upload" is the first step on both rails.
ok(/const onNewRecord = \(\) => \{[\s\S]{0,200}?setPage\("upload"\)/.test(html),
  'New Record lands on Upload, which every side\'s rail offers');
ok(navReachable('upload'), 'this side\'s rail really does offer Upload');

console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
