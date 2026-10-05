// Assertions for Record_ID computation (Phase 6): recordIdFor's fallback
// chain and assignRecordIds' collision handling.
//
//   node _test/app-harness/recordid.test.js
//
// No framework, same reasoning as crosscheck.test.js: a rung-0 check that
// needs an install before it runs is a rung-0 check nobody runs.
//
// Records are hand-built rather than pulled from DEMO_ATTACHMENTS -- the
// fallback chain and collision cases need field combinations (a record with
// no ATQ Ref. No. of its own, two records that resolve to the same ID) the
// shipped demo fixture was never written to exercise.

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

const rec = (fields) => ({ fields });
const f = (label, value) => ({ label, value });

/* ---------- record's own ATQ Ref. No. wins over the fallback ---------- */

eq('uses the record\'s own ATQ Ref. No. over fallbackBase',
  app.recordIdFor(rec([f('ATQ Ref. No.', 'ATQ-202604-00177')]), 'PR-9999'),
  'ATQ-202604-00177');

eq('appends -N when the record also carries an Item No.',
  app.recordIdFor(rec([f('ATQ Ref. No.', 'ATQ-202604-00177'), f('Item No.', '2')]), 'PR-9999'),
  'ATQ-202604-00177-2');

/* ---------- fallback chain: no own ATQ Ref. No. ---------- */

eq('falls back to fallbackBase when the record has no ATQ Ref. No. of its own',
  app.recordIdFor(rec([f('Item No.', '3')]), 'PR-9999'),
  'PR-9999-3');

eq('falls back to fallbackBase with no suffix when there is also no Item No.',
  app.recordIdFor(rec([]), 'PR-9999'),
  'PR-9999');

eq('a record with no fields at all still resolves off fallbackBase',
  app.recordIdFor(rec(undefined), 'PR-9999'),
  'PR-9999');

/* ---------- whitespace, both sides ---------- */

eq('strips whitespace off the record\'s own ATQ Ref. No.',
  app.recordIdFor(rec([f('ATQ Ref. No.', '  ATQ-202604-00177  ')]), 'PR-9999'),
  'ATQ-202604-00177');

eq('strips whitespace off fallbackBase',
  app.recordIdFor(rec([]), '  PR-9999  '),
  'PR-9999');

eq('strips whitespace off Item No. before appending it',
  app.recordIdFor(rec([f('ATQ Ref. No.', 'ATQ-1'), f('Item No.', ' 2 ')]), 'PR-9999'),
  'ATQ-1-2');

/* ---------- single item / non-ATQ: unchanged from today ---------- */

eq('a single, item-number-less record is just the fallback -- no -N suffix',
  app.recordIdFor(rec([f('Customer Name', 'ABC Company Ltd')]), 'PR-2026-01'),
  'PR-2026-01');

/* ---------- assignRecordIds: no collision ---------- */

const distinct = app.assignRecordIds(
  [rec([f('Item No.', '1')]), rec([f('Item No.', '2')])],
  'PR-9999');
eq('distinct items keep their own Record_IDs', distinct.map(x => x.recordId).join(','), 'PR-9999-1,PR-9999-2');
ok('neither is marked collided', distinct.every(x => !x.collided));

/* ---------- assignRecordIds: collision gets -a/-b ---------- */

// Two records that resolve to the very same base -- e.g. the PDF-print path,
// where neither record carries its own ATQ Ref. No. or Item No., and both
// fall all the way back to the same PR reference.
const colliding = app.assignRecordIds(
  [rec([f('Customer Name', 'ABC Company Ltd')]), rec([f('Customer Name', 'XYZ Holdings Ltd')])],
  'PR-2026-01');
eq('the first colliding item gets -a', colliding[0].recordId, 'PR-2026-01-a');
eq('the second colliding item gets -b', colliding[1].recordId, 'PR-2026-01-b');
ok('both are marked collided', colliding.every(x => x.collided));

// Three-way collision, to confirm the suffix keeps counting rather than
// resetting or repeating.
const triple = app.assignRecordIds(
  [rec([]), rec([]), rec([])],
  'PR-2026-02');
eq('a three-way collision suffixes a, b, c in order',
  triple.map(x => x.recordId).join(','), 'PR-2026-02-a,PR-2026-02-b,PR-2026-02-c');

// A mixed batch: one item collides with nothing, two others collide with
// each other. The lone item must not be touched by the other pair's suffix.
const mixed = app.assignRecordIds(
  [rec([f('Item No.', '1')]), rec([]), rec([])],
  'PR-2026-03');
eq('the non-colliding item is untouched', mixed[0].recordId, 'PR-2026-03-1');
eq('the colliding pair still gets a/b', mixed.slice(1).map(x => x.recordId).join(','),
  'PR-2026-03-a,PR-2026-03-b');

/* ---------- planSavesForItem: one upload writes ONE record ---------- */

// TEMPORARY behaviour, pinned so that restoring per-item saves has to be a
// deliberate edit to this test rather than a silent one. The end state is one
// record per ATQ item; today Save writes only the item on screen.
{
  const three = [
    rec([f('ATQ Ref. No.', 'ATQ-1'), f('Item No.', '2')]),
    rec([f('ATQ Ref. No.', 'ATQ-1'), f('Item No.', '3')]),
    rec([f('ATQ Ref. No.', 'ATQ-1'), f('Item No.', '5')]),
  ];
  const FORM = { customerName: { value: 'live form' } };
  const SNAP = { 1: { customerName: { value: 'item 3 snapshot' } } };

  const p0 = app.planSavesForItem(three, 'PR-1', 0, FORM, SNAP);
  eq('a three-item ATQ still produces exactly one plan', p0.length, 1);
  eq('...for the item on screen', p0[0].recordId, 'ATQ-1-2');

  const p1 = app.planSavesForItem(three, 'PR-1', 1, FORM, SNAP);
  eq('selecting item 3 saves item 3', p1[0].recordId, 'ATQ-1-3');
  eq('...and it saves that item\'s own snapshot, not the live form',
    p1[0].fieldsSnapshot.customerName.value, 'item 3 snapshot');
  eq('an item never visited falls back to the live form',
    app.planSavesForItem(three, 'PR-1', 2, FORM, SNAP)[0].fieldsSnapshot.customerName.value, 'live form');

  // The -a/-b suffix is only correct against the WHOLE set, so the pick has to
  // happen after assignRecordIds, not before it. Narrowing the input first
  // would give item 2 an id that silently overwrites item 3's in Dataverse.
  const collide = [
    rec([f('ATQ Ref. No.', 'ATQ-9')]),
    rec([f('ATQ Ref. No.', 'ATQ-9')]),
  ];
  eq('a collision suffix survives the narrowing (first)',
    app.planSavesForItem(collide, 'PR-1', 0, FORM, {})[0].recordId, 'ATQ-9-a');
  eq('a collision suffix survives the narrowing (second)',
    app.planSavesForItem(collide, 'PR-1', 1, FORM, {})[0].recordId, 'ATQ-9-b');

  // Single-item and empty uploads are exactly as they were.
  eq('a single-item ATQ is one plan on the live form',
    app.planSavesForItem([rec([f('ATQ Ref. No.', 'ATQ-7'), f('Item No.', '1')])], 'PR-1', 0, FORM, {})[0].recordId,
    'ATQ-7-1');
  eq('no records at all falls back to the session base',
    app.planSavesForItem([], 'PR-1', 0, FORM, {})[0].recordId, 'PR-1');
  eq('null records likewise', app.planSavesForItem(null, 'PR-1', 0, FORM, {})[0].recordId, 'PR-1');
  eq('...and that plan carries the live form', app.planSavesForItem(null, 'PR-1', 0, FORM, {})[0].fieldsSnapshot, FORM);

  // An item tab can outlive the records behind it for a render; an unclamped
  // index would read undefined and save a record with no id at all.
  eq('an index past the end clamps to the last item',
    app.planSavesForItem(three, 'PR-1', 9, FORM, {})[0].recordId, 'ATQ-1-5');
  eq('a negative index clamps to the first',
    app.planSavesForItem(three, 'PR-1', -3, FORM, {})[0].recordId, 'ATQ-1-2');
  eq('an undefined index is the first', app.planSavesForItem(three, 'PR-1', undefined, FORM, {})[0].recordId, 'ATQ-1-2');
  eq('a missing itemPlans map is not a crash',
    app.planSavesForItem(three, 'PR-1', 1, FORM, undefined)[0].fieldsSnapshot, FORM);

  // recordIdForItem reads off this list, so the Verify table's Record ID row
  // and what Save writes cannot disagree.
  eq('the Record ID row shows what will actually be saved',
    app.recordIdForItem(app.planSavesForItem(three, 'PR-1', 1, FORM, SNAP), 1), 'ATQ-1-3');
}

/* ---------- savedRecordIdOf: the lock's own rule ---------- */

// The map is the single source of "has this upload written anything". A failed
// save never reaches it, which is exactly why the lock is derived from it
// rather than set by hand next to it: a separate flag could close on a write
// that never happened and leave the record unsavable.
eq('nothing written yet leaves the lock open', app.savedRecordIdOf({}), '');
eq('an undefined map is not a crash', app.savedRecordIdOf(undefined), '');
eq('null likewise', app.savedRecordIdOf(null), '');
eq('one written record closes it, and names itself',
  app.savedRecordIdOf({ 'ATQ-1-2': true }), 'ATQ-1-2');
// Records saved before this change (or by a future per-item flow) still close
// the lock rather than reading as "nothing saved".
eq('more than one still closes it', app.savedRecordIdOf({ 'ATQ-1-2': true, 'ATQ-1-3': true }), 'ATQ-1-2');

// The second argument is what "Process Another Item" needs: one email carries
// every item's documents, so a reviewer who saved item 2 legitimately comes
// back and saves item 3 under its own Record_ID. Passed one, the lock answers
// for THAT record alone -- and the one-argument form above is untouched, which
// is the whole reason the argument is optional.
eq('per item: the item on screen is unwritten, so the lock is open',
  app.savedRecordIdOf({ 'ATQ-1-2': true }, 'ATQ-1-3'), '');
eq('per item: the item on screen is written, so the lock is closed',
  app.savedRecordIdOf({ 'ATQ-1-2': true }, 'ATQ-1-2'), 'ATQ-1-2');
eq('per item: an empty map never closes it',
  app.savedRecordIdOf({}, 'ATQ-1-2'), '');
// A blank recordId is not "a record with a blank id" -- it means the caller has
// no id yet (a render before the plans exist), and must fall back rather than
// report the upload as unsaved under a key that is not there.
eq('per item: a blank current id falls back to the whole-upload answer',
  app.savedRecordIdOf({ 'ATQ-1-2': true }, ''), 'ATQ-1-2');

/* ---------- itemProcessOptions: which items are still to do ---------- */

// done is derived from savedRecordIds, the same map savedRecordIdOf reads, so
// "is this item finished" cannot have two answers.
{
  const recs = [
    { fields: [{ label: 'Item No.', value: '2' }] },
    { fields: [{ label: 'Item No.', value: '3' }] },
  ];
  const ids = [{ recordId: 'ATQ-1-2' }, { recordId: 'ATQ-1-3' }];
  const opts = app.itemProcessOptions(recs, ids, { 'ATQ-1-2': true });
  eq('one option per item', opts.length, 2);
  eq('labelled by the ATQ item number, not the tab position', opts[0].label, 'Item 2');
  eq('each option carries the Record_ID it would be saved under', opts[1].recordId, 'ATQ-1-3');
  eq('a saved item is done', opts[0].done, true);
  eq('an unsaved item is not', opts[1].done, false);
}

// itemRecordIds is [] for a single-item upload. Nothing there has a Record_ID,
// so nothing there can read as already written -- greying the only item out
// would leave the reviewer with an empty picker.
{
  const opts = app.itemProcessOptions([{ fields: [] }], [], { 'ATQ-1-2': true });
  eq('no Record_ID means never done', opts[0].done, false);
  eq('and it still gets a positional label', opts[0].label, 'Item 1');
}

eq('no records is an empty list, not a crash', app.itemProcessOptions(null, null, null).length, 0);

/* ---------- filtering same ATQ no to disable processed items ---------- */

{
  const recs = [
    { fields: [{ label: 'Item No.', value: '1' }, { label: 'ATQ Ref. No.', value: 'ATQ-202604-00177' }] },
    { fields: [{ label: 'Item No.', value: '2' }, { label: 'ATQ Ref. No.', value: 'ATQ-202604-00177' }] },
    { fields: [{ label: 'Item No.', value: '3' }, { label: 'ATQ Ref. No.', value: 'ATQ-202604-00177' }] },
  ];
  const ids = [
    { recordId: 'ATQ-202604-00177-1' },
    { recordId: 'ATQ-202604-00177-2' },
    { recordId: 'ATQ-202604-00177-3' },
  ];

  // 1. Dataverse record matches same ATQ no and itemNo 1
  const dvRecords = [
    { atqNo: 'ATQ-202604-00177', itemNo: '1', recordId: 'ATQ-202604-00177-1', status: 'Pending' },
  ];
  const opts1 = app.itemProcessOptions(recs, ids, {}, dvRecords, 'ATQ-202604-00177');
  eq('Item 1 is disabled because it is in Dataverse for this ATQ', opts1[0].done, true);
  eq('Item 2 is not disabled', opts1[1].done, false);
  eq('Item 3 is not disabled', opts1[2].done, false);

  // 2. Different ATQ no with item 1 does NOT disable Item 1 of current ATQ
  const diffAtqRecords = [
    { atqNo: 'ATQ-202604-00999', itemNo: '1', recordId: 'ATQ-202604-00999-1', status: 'Pending' },
  ];
  const optsDiff = app.itemProcessOptions(recs, ids, {}, diffAtqRecords, 'ATQ-202604-00177');
  eq('different ATQ does not disable Item 1', optsDiff[0].done, false);

  // 3. Cancelled record in Dataverse does NOT disable the item
  const cancelledRecords = [
    { atqNo: 'ATQ-202604-00177', itemNo: '1', recordId: 'ATQ-202604-00177-1', status: 'Cancelled' },
  ];
  const optsCancelled = app.itemProcessOptions(recs, ids, {}, cancelledRecords, 'ATQ-202604-00177');
  eq('cancelled record does not disable item', optsCancelled[0].done, false);

  // 4. Started item in current session (lisStartWritten) is disabled
  const optsStarted = app.itemProcessOptions(recs, ids, {}, [], 'ATQ-202604-00177', { 'ATQ-202604-00177-2': true });
  eq('started item is disabled', optsStarted[1].done, true);
  eq('unstarted item is not disabled', optsStarted[0].done, false);

  // 5. Fallback matching via recordId prefix when atqNo column was empty (e.g. legacy row)
  const legacyRecords = [
    { atqNo: '—', itemNo: '—', recordId: 'ATQ-202604-00177-3', status: 'Completed' },
  ];
  const optsLegacy = app.itemProcessOptions(recs, ids, {}, legacyRecords, 'ATQ-202604-00177');
  eq('legacy recordId matching same ATQ disables Item 3', optsLegacy[2].done, true);

  // 6. When filter is not enabled (filterEnabled = false, new record flow), items are NOT disabled
  const optsNewRecord = app.itemProcessOptions(recs, ids, { 'ATQ-202604-00177-1': true }, dvRecords, 'ATQ-202604-00177', { 'ATQ-202604-00177-1': true }, false);
  eq('when filter is disabled (new record), Item 1 is NOT disabled', optsNewRecord[0].done, false);
  eq('all items stay enabled for new record', optsNewRecord.every(o => !o.done), true);

  // 7. processedItems map (keyed by normRef(atqNo) + '_' + itemNo) disables the item
  const procMap = { 'ATQ20260400177_1': true };
  const optsProc = app.itemProcessOptions(recs, ids, {}, [], 'ATQ-202604-00177', {}, true, procMap);
  eq('processedItems map disables Item 1', optsProc[0].done, true);
  eq('processedItems map leaves Item 2 enabled', optsProc[1].done, false);

  // 8. ATQ No. label variant is recognized by recordIdFor
  eq('ATQ No. label is recognized by recordIdFor',
    app.recordIdFor(rec([f('ATQ No.', 'ATQ-202604-00177'), f('Item No.', '1')]), 'FB'),
    'ATQ-202604-00177-1');
}

/* ---------- report ---------- */

console.log(passed + ' passed, ' + failures.length + ' failed');
if (failures.length) {
  failures.forEach(f => console.log('  FAIL  ' + f));
  process.exit(1);
}
