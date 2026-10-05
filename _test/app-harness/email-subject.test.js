// What a PR request's EMAIL SUBJECT contributes -- parseEmailSubject and the
// three readers under it.
//
//   node _test/app-harness/email-subject.test.js
//
// Procurement sends one email per ATQ item, so the subject is the only place
// that says which item an email is about. It states five things at once:
//
//   2_NON-BTB PR REQUEST (Item 10) - NEW CHARM MANAGEMENT LTD - (UID-20-02-0002-10)Type-Logger - HP - Wong Terry KL(10-Nice Systems BV)
//   ^^^^^^^                          ^^^^^^^^^^^^^^^^^^^^^^^     ^^^^^^^^^^^^^^^^^ ^^^^^^                            ^^ ^^^^^^^^^^^^^^
//   back-to-back                     customer                    uid               product type                     item  vendor
//
// None of this fills the form -- the Cost worksheet stays the document of
// record. It is a second, independent witness to compare that worksheet
// against, so what is pinned here is that the subject is read the way it is
// actually written, not that it wins an argument.
//
// FIXTURES: the layout, bracketing and word shapes are from five real subjects;
// every UID, PO number and person's name is substituted. Company names are
// kept, as everywhere else in this directory -- see the root CLAUDE.md. The two
// properties the substitution deliberately PRESERVES, because both are
// load-bearing:
//
//   - S1's UID carries no trailing group at all while its bracket says item 1.
//   - S4's UID ends "-2" while its bracket says item 3.
//
// Those are why the trailing bracket is the item marker and the UID's own tail
// is not. Renumber them and the test stops testing anything.

const { load } = require('./app.js');
const app = load();

let passed = 0;
const failures = [];

function ok(label, cond, detail) {
  if (cond) { passed++; return; }
  failures.push(label + (detail === undefined ? '' : '\n      got: ' + JSON.stringify(detail).slice(0, 400)));
}
function eq(label, actual, expected) { ok(label, actual === expected, { actual, expected }); }

const S1 = '1_BTB PR REQUEST - THE UNIVERSITY OF HONG KONG - (UID-20-01-0001)Type-Security - Cisco - Chan Alex TM(1-Cisco).msg';
const S2 = '2_NON-BTB PR REQUEST (Item 10) - NEW CHARM MANAGEMENT LTD - (UID-20-02-0002-10)Type-Logger - HP - Wong Terry KL(10-Nice Systems BV).msg';
const S3 = '1. BTB PR REQUEST (Item 4) - FUBON BANK (HONG KONG) LIMITED - (UID-20-03-0003-4)Type-Networking - F5 Load Balance - Lam Ivy WS; Ho Gary SY(4-BData).msg';
const S4 = '2. URGENT NON BTB PR REQUEST - OCBC BANK (HONG KONG) LIMITED - (UID-20-04-0004-2)Type-Networking - Huawei products - Lam Ivy WS; Ho Gary SY(3-DCSS Technology (Hong Kong) Limited).msg';
const S5 = '1.2 PO1000001 po closed BTB PR REQUEST (Item 4) - FUBON BANK (HONG KONG) LIMITED - (UID-20-03-0003-4)Type-Networking - F5 Load Balance - Lam Ivy WS; Ho Gary SY(4-BData).msg';

const p1 = app.parseEmailSubject(S1);
const p2 = app.parseEmailSubject(S2);
const p3 = app.parseEmailSubject(S3);
const p4 = app.parseEmailSubject(S4);
const p5 = app.parseEmailSubject(S5);

/* ---------- 1. The five real shapes, whole ---------- */

eq('S1 uid', p1.uid, 'UID-20-01-0001');
eq('S2 uid', p2.uid, 'UID-20-02-0002-10');
eq('S3 uid', p3.uid, 'UID-20-03-0003-4');
eq('S4 uid', p4.uid, 'UID-20-04-0004-2');
eq('S5 uid -- a re-sent thread keeps the original request\'s uid', p5.uid, 'UID-20-03-0003-4');

/* ---------- 1b. A suffix the UID carries in LOWERCASE ---------- */

// Measured, not invented: a real request is titled
// "... - G260690247TS_WIFI_(UID-26-06-0151-1b)[Type-WirelessLan - ...]".
// The suffix class used to be uppercase-only, so the "b" was dropped and the app
// reported "UID-26-06-0151-1" -- a UID that is not the one printed, and one that
// collides with a sibling "-1a" request. A dropped character is silent: nothing
// on screen says the value is short.
//
// The uppercase rule is still there and still earns its place, so the fix is an
// ALTERNATIVE rather than a widened class. These two cases are the pair that
// pins it -- remove either and the other stops proving anything.
{
  const s = 'URGENT BTB PR REQUEST - NAN FUNG DEVELOPMENT LTD - '
    + 'G200690001TS_WIFI_(UID-20-12-0012-1b)[Type-WirelessLan - Cisco - Chan Alex TM(2-BData)]';
  const p = app.parseEmailSubject(s);
  eq('a lowercase suffix survives, whole', p.uid, 'UID-20-12-0012-1b');
  eq('...and extractUid agrees with parseEmailSubject', app.extractUid(s), 'UID-20-12-0012-1b');
  ok('...so it is not the sibling request', p.uid !== 'UID-20-12-0012-1a');
  // The half-fix that looks right: uppercasing the match keeps every character
  // but not the printed value.
  ok('...and the case is the email\u2019s, not folded to upper', /1b$/.test(p.uid), p.uid);
}

// The door the uppercase-only rule was closing, which must stay shut. "and" is
// three lowercase letters glued to the number in a forwarded body; a widened
// [A-Za-z]{0,3} swallows it whole, and a bare one-character cap takes its "a"
// and reports a wrong UID. Only "one lowercase letter, and no letter after it"
// rejects this while still accepting "-1b)".
eq('a word glued to the number is not a suffix',
  app.extractUid('UID-20-13-0013and approved'), 'UID-20-13-0013');
eq('...nor is it partly one', app.extractUid('UID-20-13-0013and approved'), 'UID-20-13-0013');
eq('a single lowercase letter followed by a space still is one',
  app.extractUid('UID-20-13-0013a approved'), 'UID-20-13-0013a');
eq('an uppercase suffix is untouched by all of this',
  app.extractUid('(UID-20-06-0006A)'), 'UID-20-06-0006A');
eq('and a lowercase UID prefix is still normalised',
  app.extractUid('see uid-20-12-0012-1b here'), 'UID-20-12-0012-1b');

eq('S1 product type', p1.productType, 'Security');
eq('S2 product type', p2.productType, 'Logger');
eq('S3 product type', p3.productType, 'Networking');
eq('S4 product type', p4.productType, 'Networking');

eq('S1 vendor', p1.vendor, 'Cisco');
eq('S2 vendor', p2.vendor, 'Nice Systems BV');
eq('S3 vendor', p3.vendor, 'BData');
eq('S4 vendor -- a vendor name may nest its own brackets',
  p4.vendor, 'DCSS Technology (Hong Kong) Limited');

eq('S1 customer', p1.customerName, 'THE UNIVERSITY OF HONG KONG');
eq('S2 customer', p2.customerName, 'NEW CHARM MANAGEMENT LTD');
eq('S3 customer -- brackets in the name are part of it',
  p3.customerName, 'FUBON BANK (HONG KONG) LIMITED');
eq('S4 customer', p4.customerName, 'OCBC BANK (HONG KONG) LIMITED');
eq('S5 customer -- the furniture to the left may be arbitrarily long',
  p5.customerName, 'FUBON BANK (HONG KONG) LIMITED');

/* ---------- 2. Which marker decides the item ---------- */

// The whole point of the trailing bracket. S1 has no "(Item N)" and a UID with
// no trailing group; the bracket is the only thing that names an item at all.
eq('S1 item comes from the trailing bracket', p1.itemNo, '1');
eq('...and there is no printed "(Item N)" to have taken it from', p1.itemNoPrinted, '');

// S4 is the case that settles it: the UID ends "-2", the bracket says 3.
eq('S4 item is the bracket\'s 3, not the UID\'s trailing 2', p4.itemNo, '3');
ok('...and the uid still ends in 2, so the two really do disagree',
  /-2$/.test(p4.uid), p4.uid);
eq('...with no printed marker on this one either', p4.itemNoPrinted, '');

// Where both are printed they agree, and both are reported -- a disagreement
// between them is a fact worth being able to see, so they are not merged.
eq('S2 item', p2.itemNo, '10');
eq('S2 also prints "(Item 10)"', p2.itemNoPrinted, '10');
eq('S3 item', p3.itemNo, '4');
eq('S3 also prints "(Item 4)"', p3.itemNoPrinted, '4');

// A customer's own brackets must never be mistaken for the item marker. This
// subject has "(HONG KONG)" and no trailing bracket at all.
{
  const s = 'BTB PR REQUEST (Item 7) - FUBON BANK (HONG KONG) LIMITED - (UID-20-05-0005-7)Type-Networking - F5 Load Balance';
  const p = app.parseEmailSubject(s);
  eq('a bracketed customer name is not an item marker', p.itemNo, '7');
  eq('...which came from the printed marker, the fallback', p.itemNoPrinted, '7');
  eq('...and no vendor was invented from it', p.vendor, '');
}

// The item bracket is the LAST such group, not the first. A product line can
// carry one of its own -- "(10-Gigabit uplink)" reads as an item marker on
// every test the shape can apply -- and it sits to the LEFT of the item's, so a
// scan that stopped at the first would report a port speed as the item number
// and "Gigabit uplink" as the vendor.
{
  const s = 'BTB PR REQUEST - NEW CHARM MANAGEMENT LTD - (UID-20-14-0014-2)Type-Networking - (10-Gigabit uplink) switch - Chan Alex TM(2-BData)';
  const p = app.parseEmailSubject(s);
  eq('the last bracketed group wins, not the first', p.itemNo, '2');
  eq('...so the vendor is the tail\'s, not the product line\'s', p.vendor, 'BData');
}

// Neither marker printed.
{
  const p = app.parseEmailSubject('BTB PR REQUEST - NEW CHARM MANAGEMENT LTD - (UID-20-06-0006)Type-Logger - HP');
  eq('no item marker at all is "", not a guess', p.itemNo, '');
  eq('...and the uid is still read', p.uid, 'UID-20-06-0006');
}

/* ---------- 3. Back-to-Back: why \b is the wrong tool ---------- */

// "2_NON-BTB" glues NON to an underscore, which IS a word character. \bNON
// never matches it while \bBTB does, so the subject that says NON-BTB loudest
// is exactly the one a \b rule reads as back-to-back.
eq('S2 is NON-BTB', p2.backToBack, 'N');
eq('S4 is NON BTB, spelt with a space', p4.backToBack, 'N');
eq('S1 is BTB, and the leading "1_" does not hide it', p1.backToBack, 'Y');
eq('S3 is BTB', p3.backToBack, 'Y');
eq('S5 is BTB', p5.backToBack, 'Y');
eq('a subject that says neither reports neither',
  app.parseEmailSubject('PR REQUEST - NEW CHARM MANAGEMENT LTD - (UID-20-07-0007)Type-Logger').backToBack, '');
eq('a word merely containing the letters is not a marker',
  app.parseEmailSubject('BTBX REQUEST - NEW CHARM MANAGEMENT LTD - (UID-20-08-0008)Type-Logger').backToBack, '');

/* ---------- 4. Dashes: which ones separate and which belong ---------- */

// A spaced dash separates; a bare one is part of the token. Splitting on either
// would cut both of these in half.
eq('a hyphenated customer name survives',
  app.parseEmailSubject('BTB PR REQUEST - PCCW-HKT Limited - (UID-20-09-0009-1)Type-Networking - x - Chan Alex TM(1-Cisco)').customerName,
  'PCCW-HKT Limited');
eq('a hyphenated product type survives',
  app.parseEmailSubject('BTB PR REQUEST - NEW CHARM MANAGEMENT LTD - (UID-20-10-0010-1)Type-Wi-Fi - AP - Chan Alex TM(1-Cisco)').productType,
  'Wi-Fi');
eq('a product type at the very end of the subject still reads',
  app.parseEmailSubject('BTB PR REQUEST - NEW CHARM MANAGEMENT LTD - (UID-20-11-0011-1)Type-Security').productType,
  'Security');

/* ---------- 5. Reading the subject off a parsed .msg ---------- */

// The engine writes "Subject: " + subject as a header line above the body
// (processMsg / processEml). The body of a forwarded thread quotes an older
// request, so the subject is read as its OWN LINE rather than by scanning the
// whole text -- which only finds the right UID because the header happens to
// come first, and that is luck rather than a rule.
{
  const text = [
    'From: procurement@example.com',
    'To: pr-team@example.com',
    'Subject: ' + S2.replace(/\.msg$/, ''),
    'Date: Mon, 20 Apr 2026 09:38:44 +0800',
    '',
    'Please process the attached ATQ.',
    '',
    '> -----Original Message-----',
    '> Subject: BTB PR REQUEST - OCBC BANK (HONG KONG) LIMITED - (UID-20-99-9999-1)Type-Networking - x - Chan Alex TM(1-Cisco)',
  ].join('\n');
  eq('the header line is the subject', app.subjectLineOf(text),
    S2.replace(/\.msg$/, ''));
  eq('...so the quoted thread below does not supply the uid',
    app.parseEmailSubject(app.subjectLineOf(text)).uid, 'UID-20-02-0002-10');
  eq('no Subject header is "", not the first thing that looks like one',
    app.subjectLineOf('Please see attached. (UID-20-99-9999-1)'), '');
  eq('a header with no value is ""', app.subjectLineOf('Subject:\nFrom: x'), '');
}

// A .msg saved to disk is named after its subject, which is the second place
// this is read from -- so the extension has to come off.
eq('the .msg extension is not part of the subject', p1.subject.slice(-4) !== '.msg', true);
eq('nor is .eml', app.parseEmailSubject('PR REQUEST - X Ltd - (UID-20-12-0012)Type-Logger.eml').subject.slice(-4) !== '.eml', true);

/* ---------- 6. The shape a real .msg actually carries ---------- */

// Measured end to end: a real .msg through DocparseEngine.parseFile under Node,
// reading the "Subject: " header line processMsg writes above the body. Two
// things the file-name fixtures above could not have shown, because a saved
// file name is not the subject -- it is Windows' rendering of one:
//
//   - the subject wraps everything after the UID in SQUARE brackets, which the
//     file name does not have
//   - the subject has no "2_" ordering prefix, so NON-BTB starts the string
//
// Both parse to exactly the same record as the file name does, which is the
// property that matters: the two tiers of uidFromEmail must not disagree.
{
  const HEADER = 'NON-BTB PR REQUEST (Item 10) - NEW CHARM MANAGEMENT LTD - (UID-20-02-0002-10)[Type-Logger - HP - Wong, Terry KL(10-Nice Systems BV)]';
  const p = app.parseEmailSubject(HEADER);
  eq('square brackets around the tail do not hide the type', p.productType, 'Logger');
  eq('...nor the vendor, whose own bracket closes inside them', p.vendor, 'Nice Systems BV');
  eq('...nor the item', p.itemNo, '10');
  eq('NON-BTB at the very start of the string is still NON-BTB', p.backToBack, 'N');
  eq('a comma inside a person\'s name does not split the customer off',
    p.customerName, 'NEW CHARM MANAGEMENT LTD');
  // The subject strings differ; the records they yield must not.
  const fromName = app.parseEmailSubject(S2);
  ['uid', 'productType', 'itemNo', 'vendor', 'customerName', 'backToBack'].forEach(k =>
    eq('header and file name agree on ' + k, p[k], fromName[k]));
}

/* ---------- 7. Edges ---------- */

eq('an empty subject is null', app.parseEmailSubject(''), null);
eq('whitespace only is null', app.parseEmailSubject('   '), null);
eq('null in, null out', app.parseEmailSubject(null), null);
eq('a subject with none of this in it still returns a record',
  app.parseEmailSubject('Lunch?').uid, '');

// A file name cut at the path limit loses its closing bracket. The tail is
// still worth reading -- half a vendor name beats none, and the item number is
// in front of it either way.
{
  const p = app.parseEmailSubject('BTB PR REQUEST - NEW CHARM MANAGEMENT LTD - (UID-20-13-0013-4)Type-Networking - x - Chan Alex TM(4-DCSS Technolo');
  eq('a truncated trailing bracket still yields its item', p.itemNo, '4');
  eq('...and what there is of the vendor', p.vendor, 'DCSS Technolo');
}

// trailingItemVendor builds its /g regex per call. Hoisting it would carry
// lastIndex between calls and make every second read return null.
{
  const a = app.trailingItemVendor(S2);
  const b = app.trailingItemVendor(S2);
  eq('the same subject read twice gives the same answer', JSON.stringify(a), JSON.stringify(b));
  eq('...and it is the right one', a.itemNo, '10');
  eq('a subject with no bracketed item at all is null',
    app.trailingItemVendor('BTB PR REQUEST - NEW CHARM MANAGEMENT LTD'), null);
}

// subjectCustomer needs something to the LEFT of the name; a subject that is
// nothing but a name has no request furniture and no customer to isolate.
eq('one segment is not a customer', app.subjectCustomer('NEW CHARM MANAGEMENT LTD - ('), '');

/* ---------- 8. "(Item 2 & 3)": the list of items COVERED, vs the one item
                  this email is FOR ---------- */

// One PR request can cover several items of the Cost worksheet, and the subject
// prints the whole set -- but procurement still sends one email per item, so the
// trailing bracket names the single item THIS mail is about. Two markers, two
// different questions; the old single-number pattern read neither on this shape,
// because it required the ")" to follow one number immediately.
//
// FIXTURE: real bracketing and real square-bracket wrapper; UID renumbered and
// both requestors substituted. Company names kept, as everywhere here.
const S6 = 'NON-BTB PR REQUEST (Item 2 & 3) - HONG KONG DESIGN CENTRE LIMITED - (UID-20-07-0007-2-3)[Type-UCBV AV Equipment - Lam Ivy WS; Ho Gary SY(2-NEXUS2S)]';
const p6 = app.parseEmailSubject(S6);

eq('S6 covers items 2 and 3', JSON.stringify(p6.itemsCovered), '["2","3"]');
eq('...but THIS email is about item 2 -- the trailing bracket, not the list',
  p6.itemNo, '2');
eq('...and a list of two names no single printed item, so the fallback stays empty',
  p6.itemNoPrinted, '');
eq('S6 uid keeps both trailing groups', p6.uid, 'UID-20-07-0007-2-3');
eq('S6 vendor is the trailing bracket, not the printed list', p6.vendor, 'NEXUS2S');
eq('S6 customer', p6.customerName, 'HONG KONG DESIGN CENTRE LIMITED');
eq('S6 is NON-BTB even with no "2_" in front of it', p6.backToBack, 'N');

// The two product-type readings are deliberately kept apart. The narrow one is
// what the cross-check compares against a document's Product Type; the raw one
// carries the requestors glued on, so comparing IT would report a standing
// conflict against every document that ever states a product type.
eq('S6 narrow productType stops at the spaced dash', p6.productType, 'UCBV AV Equipment');
eq('S6 raw productType is the whole square bracket, minus the vendor bracket',
  p6.productTypeRaw, 'Type-UCBV AV Equipment - Lam Ivy WS; Ho Gary SY');
ok('...so the vendor bracket is never swallowed into it',
  p6.productTypeRaw.indexOf('NEXUS2S') < 0 && p6.productTypeRaw.indexOf('(2-') < 0,
  p6.productTypeRaw);
eq('the raw reading survives with no trailing bracket at all, closing "]" stripped',
  app.parseEmailSubject('BTB PR REQUEST - HONG KONG DESIGN CENTRE LIMITED - (UID-20-07-0008)[Type-Logger - HP]').productTypeRaw,
  'Type-Logger - HP');
eq('no "Type-" at all means no raw reading rather than a wrong one',
  app.parseEmailSubject('BTB PR REQUEST - NEW CHARM MANAGEMENT LTD - (UID-20-07-0009)(1-Cisco)').productTypeRaw, '');

// The five original fixtures keep the narrow reading they always had -- the raw
// one is additive, not a redefinition.
eq('S1 narrow productType unchanged', p1.productType, 'Security');
eq('S2 narrow productType unchanged', p2.productType, 'Logger');
eq('S1 raw productType', p1.productTypeRaw, 'Type-Security - Cisco - Chan Alex TM');

// A single printed item behaves exactly as before: it IS a usable fallback.
eq('S2 prints one item, so it still lists one', JSON.stringify(p2.itemsCovered), '["10"]');
eq('...and still stands in as the printed marker', p2.itemNoPrinted, '10');
eq('S3 likewise', JSON.stringify(p3.itemsCovered), '["4"]');
eq('a subject printing no marker lists nothing rather than echoing the tail',
  JSON.stringify(p4.itemsCovered), '[]');
eq('...even though its trailing bracket names item 3', p4.itemNo, '3');

// Refusing the near miss: a multi-item list with no trailing bracket leaves the
// item unknown. Guessing "2" here would anchor the whole page on an item nobody
// asked about, with nothing on screen saying so.
{
  const p = app.parseEmailSubject('NON-BTB PR REQUEST (Item 2 & 3) - HONG KONG DESIGN CENTRE LIMITED - (UID-20-07-0010-2-3)Type-UCBV AV Equipment');
  eq('a list of two with no trailing bracket names no item', p.itemNo, '');
  eq('...but the list itself is still reported', JSON.stringify(p.itemsCovered), '["2","3"]');
}

/* ---------- 8b. the separators actually seen, and the ones that must not
                  become items ---------- */

const list = s => JSON.stringify(app.printedItemList(s));
eq('ampersand', list('X (Item 2 & 3) - Y'), '["2","3"]');
eq('comma', list('X (Item 2,3) - Y'), '["2","3"]');
eq('the word and', list('X (Item 2 and 3) - Y'), '["2","3"]');
eq('plus', list('X (Item 2 + 3) - Y'), '["2","3"]');
eq('three of them', list('X (Item 2 & 3 & 5) - Y'), '["2","3","5"]');
eq('plural "Items"', list('X (Items 2 & 3) - Y'), '["2","3"]');
eq('"Item No. 4"', list('X (Item No. 4) - Y'), '["4"]');
eq('"Item Nos. 4 & 5"', list('X (Item Nos. 4 & 5) - Y'), '["4","5"]');
eq('order is the printed order, not sorted', list('X (Item 10 & 2) - Y'), '["10","2"]');
eq('no marker at all', list('BTB PR REQUEST - NEW CHARM MANAGEMENT LTD'), '[]');
eq('null in, empty list out', list(null), '[]');

// The word "item" is required. A customer or vendor bracket full of digits is
// not an item list, and neither is the trailing "(N-Vendor)" marker.
eq('the trailing item-vendor bracket is not a printed list',
  list('X - (UID-20-07-0011)Type-Logger(2-NEXUS2S)'), '[]');
eq('a bare number in brackets is not a printed list', list('X (2 & 3) - Y'), '[]');
eq('a customer with a bracket is not a printed list',
  list('BTB PR REQUEST - FUBON BANK (HONG KONG) LIMITED - (UID-20-07-0012)'), '[]');
ok('a company whose name contains "and" contributes no items',
  app.printedItemList('BTB PR REQUEST - BLACK AND WHITE LIMITED - (UID-20-07-0013)').length === 0);

// subjectTypeBlock's own boundaries, read directly.
{
  const s = 'junk before [Type-Logger - HP(3-Cisco)]';
  eq('the block starts at the literal "Type" and stops at the tail bracket',
    app.subjectTypeBlock(s, 0, s.indexOf('(3-')), 'Type-Logger - HP');
  eq('...and the tail index parseEmailSubject feeds it is that same opener',
    app.trailingItemVendor(s).at, s.indexOf('(3-'));
}
eq('a negative tail index means read to the end',
  app.subjectTypeBlock('[Type-Logger - HP]', 0, -1), 'Type-Logger - HP');
eq('no "Type" in the segment is "", not the segment', app.subjectTypeBlock('[nothing here]', 0, -1), '');

/* ---------- a UID that ends in a letter ---------- */

// Measured on a real subject: "(UID-26-06-0037A)". The digits-only pattern read
// it as "UID-26-06-0037" -- not the UID that was printed, with nothing on screen
// saying a character had been dropped. A wrong reference is worse than none:
// it looks answered and matches the wrong Dataverse record.
const suffixed = app.parseEmailSubject(
  '2_NON-BTB PR REQUEST (Item 1) - NEW CHARM MANAGEMENT LTD - (UID-26-06-0037A)[Type-Logger - HP - Requestor(1-Cisco)]');
eq('a trailing letter stays on the UID', suffixed.uid, 'UID-26-06-0037A');
eq('...and the rest of the subject still reads past it', suffixed.vendor, 'Cisco');
eq('...including the product type, which is found AFTER the uid match ends',
  suffixed.productType, 'Logger');

eq('a multi-letter suffix survives too',
  app.extractUid('X - (UID-26-06-0037AB) y'), 'UID-26-06-0037AB');
eq('a suffix on a middle group is kept as well',
  app.extractUid('(UID-26-06-0037A-2)'), 'UID-26-06-0037A-2');
eq('a plain UID is unchanged', app.extractUid('X - (UID-26-06-0037)'), 'UID-26-06-0037');
eq('...and so is a two-group tail', app.extractUid('(UID-20-07-0007-2-3)'), 'UID-20-07-0007-2-3');

// The suffix class is case-SENSITIVE on purpose. With the old /i flag in force
// "[A-Z]" also matched lowercase, so a forwarded body that glues a word onto the
// number would have had it swallowed into the UID.
eq('a word glued to the number is not swallowed',
  app.extractUid('UID-26-07-0126and approved'), 'UID-26-07-0126');
eq('the UID literal itself is still case-insensitive',
  app.extractUid('see uid-26-07-0126 please'), 'UID-26-07-0126');

/* ---------- 9. The UID comes from the BODY, not the subject (2026-09-25) ----------

   Reversed at the user's request. The engine writes an email as a header block
   over the body, so the old "first UID anywhere in plainText" read the subject
   by POSITION -- emailBodyTextOf is what cuts that header off, and uidFromEmail
   asks the body before the subject.

   The fixture is the engine's own shape: the `=== Email Body ===` label, the
   header lines, a blank separator, the body, then an attachment block. */

const BODY_MAIL = [
  '=== Email Body ===',
  '',
  'Subject: NON-BTB PR REQUEST - ACME LTD - (UID-20-02-0002-10)[Type-Logger]',
  'From: someone@example.com',
  'To: someone.else@example.com',
  'Date: Thu, 25 Sep 2026 09:00:00 +0800',
  '',
  'Dear all,',
  'Please process the request below.',
  'UID: UID-20-05-0005-7',
  'Thanks.',
  '',
  '=== Attachment: quotation.pdf ===',
  '',
  'UID-20-09-0009-1',
].join('\n');

const bodyOnly = app.emailBodyTextOf(BODY_MAIL);
ok('the body drops the Subject header line', !/Subject:/.test(bodyOnly), bodyOnly);
ok('...and every other header line with it', !/^From:/m.test(bodyOnly), bodyOnly);
ok('the body itself survives', /Please process the request below\./.test(bodyOnly), bodyOnly);
ok('the attachment block is not part of the body',
  !/quotation\.pdf/.test(bodyOnly) && !/UID-20-09-0009-1/.test(bodyOnly), bodyOnly);

eq("the UID read off the body is the body's, not the subject's",
  app.extractUid(bodyOnly), 'UID-20-05-0005-7');
eq('...which the whole plain text would NOT have given',
  app.extractUid(BODY_MAIL), 'UID-20-02-0002-10');

// Text with no Subject header is not an email and is handed back whole. A
// quotation PDF dropped on a tab has always had its UID read, and narrowing
// this to "emails only" would stop that silently.
eq('text carrying no Subject header is returned whole',
  app.emailBodyTextOf('Quotation Q1\nUID-20-08-0008-4'), 'Quotation Q1\nUID-20-08-0008-4');
eq('null in, empty string out', app.emailBodyTextOf(null), '');

// uidFromEmail's three tiers, one fixture each. `Contract` is just a tab name;
// a mail can be dropped on any of the four.
{
  const att = { 'Contract': { text: BODY_MAIL, file: 'req.msg' } };
  eq('tier 1 -- the body wins over the subject',
    app.uidFromEmail(att, { uid: { value: 'UID-20-07-0007-9' } }), 'UID-20-05-0005-7');
  eq('uidFromEmailBody agrees with it', app.uidFromEmailBody(att), 'UID-20-05-0005-7');
}
{
  // Same mail with the UID taken out of the body: the subject is tier 2, so the
  // value does not vanish -- an email that prints no UID in its body behaves
  // exactly as it did before this change.
  const noBodyUid = BODY_MAIL.replace('UID: UID-20-05-0005-7', 'Thanks in advance.');
  const att = { 'Contract': { text: noBodyUid, file: 'req.msg' } };
  eq('tier 2 -- no UID in the body falls back to the subject',
    app.uidFromEmail(att, { uid: { value: 'UID-20-07-0007-9' } }), 'UID-20-02-0002-10');
  eq('...and the body tier reports nothing for it', app.uidFromEmailBody(att), '');
}
{
  // Neither body nor subject states one: the form field is still the floor.
  const att = { 'Contract': { text: '=== Email Body ===\n\nSubject: Lunch?\nFrom: a@b\n\nSee you at 1.', file: 'lunch.msg' } };
  eq('tier 3 -- the form field is still the floor',
    app.uidFromEmail(att, { uid: { value: 'UID-20-07-0007-9' } }), 'UID-20-07-0007-9');
}

// The `subject` argument short-circuits the SUBJECT tier only. The body tier
// reads `attachments` either way, so handing in a pre-parsed subject must not
// change the answer when the body has one.
{
  const att = { 'Contract': { text: BODY_MAIL, file: 'req.msg' } };
  const pre = app.emailSubjectOf(att);
  eq('a pre-parsed subject does not override the body',
    app.uidFromEmail(att, { uid: { value: '' } }, pre), 'UID-20-05-0005-7');
}

// The body STOPS at the thread this mail is replying to. A forwarded request
// quotes an older one's subject line, UID and all, and that text belongs to the
// previous mail -- so it is not "the body" and the first-UID-wins rule never
// reaches it. Pinned in n8n-send.test.js against a measured fixture too.
{
  const fwd = [
    '=== Email Body ===',
    '',
    'Subject: BTB PR REQUEST - ABC Company Ltd - (UID-20-03-0003-4)Type-Networking',
    'From: a@example.com',
    '',
    'Please see below.',
    '',
    '> -----Original Message-----',
    '> Subject: PR REQUEST - ABC Company Ltd - (UID-20-99-9999-1)Type-Logger',
  ].join('\n');
  ok('a quoted thread is not part of the body',
    !/UID-20-99-9999-1/.test(app.emailBodyTextOf(fwd)), app.emailBodyTextOf(fwd));
  eq('...so the quoted UID never wins, and the subject tier answers instead',
    app.uidFromEmail({ 'Contract': { text: fwd, file: 'f.msg' } }, { uid: { value: '' } }),
    'UID-20-03-0003-4');
  ok('an unprefixed Outlook separator ends it too',
    !/UID-20-99-9999-1/.test(app.emailBodyTextOf(fwd.replace(/^> /gm, ''))),
    app.emailBodyTextOf(fwd.replace(/^> /gm, '')));
}

/* ---------- report ---------- */

if (failures.length) {
  console.error('\n' + failures.length + ' FAILED of ' + (passed + failures.length) + ':\n');
  failures.forEach(f => console.error('  - ' + f));
  process.exit(1);
}
console.log(passed + ' assertions passed, 0 failed');
