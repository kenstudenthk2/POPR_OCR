// Which party a chop or a signature belongs to — DocparseEngine's
// attachMarkContext, plus the App's reading of the answer.
//
//   node _test/app-harness/chop-owner.test.js
//
// The engine half needs no browser: attachMarkContext takes boxes and marks
// that are already normalised to page fractions, so its column and cue rules
// run under plain Node. That matters, because the browser ladder in
// Docparse/CLAUDE.md is exactly where this logic is hardest to eyeball — a
// wrong column silently attributes a chop to the other party, which looks
// identical to a right answer unless you already know which is which.
//
// The fixtures below are NOT invented. Every box is the measured geometry of a
// real page in `Demo Data/chop/`, read off a browser run of inspectPdfPage and
// a page render at the same scale:
//
//   - Maintenance Service Agreement (Customer signed).pdf, page 1. Scanned, so
//     the boxes are OCR's. Two columns: HKT signs on the left under "Yours
//     sincerely", the customer chops on the right under "For and on behalf of".
//     Both chops were found by the ink pass at the bboxes used here, and both
//     came back from readChopText as junk ("lons (HK1) Limited 6",
//     "on ehalf A uthority-WHSI") — which is why the printed block is read
//     instead.
//   - Q2026050009R HKT HKDC (A3269 ).pdf, page 1. Text layer. The vendor chops
//     on the left; the "Accepted By" column on the right is blank, and no mark
//     was found there.

const path = require('path');
const fs = require('fs');
const vm = require('vm');

// The engine hands itself to globalThis and touches no DOM at load time, so it
// can be evaluated straight into this process. Nothing here calls a path that
// needs pdf.js, XLSX or the OCR model.
const ENGINE = path.join(__dirname, '..', '..', 'Docparse', 'docparse-engine.js');
vm.runInThisContext(fs.readFileSync(ENGINE, 'utf8'), { filename: 'docparse-engine.js' });
const { attachMarkContext } = globalThis.DocparseEngine;

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

// One text line as a single box. attachMarkContext regroups boxes into lines
// itself; a whole line arriving as one box is the simple case, and the split
// case gets its own test at the bottom.
function line(text, x, right, y, h) {
  return { x, y, w: right - x, h: h === undefined ? 0.010 : h, text };
}
function mark(kind, x, y, w, h) {
  return { kind, confidence: 0.9, color: null, bbox: { x, y, w, h } };
}

/* ---------- Maintenance Service Agreement p1: HKT left, customer right ---------- */

function maintenancePage() {
  return [
    line('Yours sincerely', 0.100, 0.220, 0.700),
    line('Hong Kong Telecommunications (HKT) Limited', 0.100, 0.414, 0.712),
    line('Chan', 0.100, 0.160, 0.800),
    line('Assistant Service Manager', 0.100, 0.250, 0.812),
    line('Commercial Group - Service Business', 0.100, 0.290, 0.824),
    line('For and on behalf of', 0.508, 0.641, 0.700),
    line("Hospital Authority - TWGHS, Int'l Funeral Parlour", 0.508, 0.807, 0.712),
    line("Customer's Signature & Company Chop", 0.508, 0.750, 0.818, 0.012),
    line('Date :', 0.508, 0.550, 0.840),
  ];
}

const hktChop = mark('chop', 0.321, 0.721, 0.110, 0.070);
const customerChop = mark('chop', 0.626, 0.705, 0.126, 0.111);
const hktSignature = mark('signature', 0.130, 0.730, 0.170, 0.050);

const maintenance = [hktChop, customerChop, hktSignature];
attachMarkContext(maintenance, maintenancePage());

eq('the left chop is named by the block above it, not by its own arc',
  hktChop.context && hktChop.context.name, 'Hong Kong Telecommunications (HKT) Limited');
eq('a "Yours sincerely" sign-off introduces a party just as "on behalf of" does',
  hktChop.context && hktChop.context.cue, 'Yours sincerely');
eq('the right chop belongs to the counterparty',
  customerChop.context && customerChop.context.name,
  "Hospital Authority - TWGHS, Int'l Funeral Parlour");
eq('the ruled line under the ink is reported as the label, never as a party',
  customerChop.context && customerChop.context.label,
  "Customer's Signature & Company Chop");
eq('a signature gets an owner too — handwriting carries no name of its own',
  hktSignature.context && hktSignature.context.name, 'Hong Kong Telecommunications (HKT) Limited');

// The whole point of the column test. A chop stamped in the right-hand column
// must never be attributed to the party named on the left, and vice versa.
ok('columns do not leak into each other',
  hktChop.context.name !== customerChop.context.name,
  { left: hktChop.context.name, right: customerChop.context.name });

/* ---------- the geometry each rule actually depends on ---------- */

// The customer's seal overlaps the name printed above it by a third of its own
// height — measured, not hypothetical. Requiring the name to clear the mark's
// TOP would leave that chop unowned.
const overlapping = mark('chop', 0.626, 0.705, 0.126, 0.111);
attachMarkContext([overlapping], maintenancePage());
ok('a chop stamped over the name above it still finds its owner',
  overlapping.context && /Hospital Authority/.test(overlapping.context.name));

// A cue is far narrower than the company name under it. Matching the cue
// against the MARK's column finds nothing, which is why it is matched against
// the name's column instead.
ok('a short cue over a wide name is still the same column',
  hktChop.context.cue === 'Yours sincerely');

// No cue above a wide line means no party. Without this a chop over any
// address block would be reported as belonging to the address.
const noCue = mark('chop', 0.321, 0.721, 0.110, 0.070);
attachMarkContext([noCue], [
  line('Hong Kong Telecommunications (HKT) Limited', 0.100, 0.414, 0.712),
  line('41/F PCCW Tower, Taikoo Place', 0.100, 0.380, 0.700),
]);
ok('a company name with no sign-off cue above it names nobody', !noCue.context, noCue.context);

// A mark far from any sign-off block is not owned by the nearest text on the
// page. CONTEXT_MAX_ABOVE is what stops a page-wide search.
const distant = mark('chop', 0.321, 0.930, 0.110, 0.070);
attachMarkContext([distant], maintenancePage());
ok('a mark well below the sign-off block is left unowned', !distant.context, distant.context);

/* ---------- Q2026050009R p1: vendor chops, "Accepted By" column blank ---------- */

// The seal is small and sits to the RIGHT of the name above it, overlapping
// only its last few characters — the tightest column match on the corpus, and
// what CONTEXT_MIN_COLUMN_OVERLAP is actually calibrated against.
const vendorChop = mark('chop', 0.188, 0.603, 0.064, 0.037);
attachMarkContext([vendorChop], [
  line('For and on behalf of', 0.098, 0.197, 0.573),
  line('Xtreme Lighting Limited', 0.098, 0.214, 0.585),
  line('Authorized Signature(s)', 0.098, 0.213, 0.655, 0.012),
  line('Accepted By: Sign/Stamp/Date', 0.560, 0.709, 0.573),
  line('Signature & Company Chop', 0.560, 0.700, 0.655, 0.012),
]);
eq('the vendor quotation names its own vendor',
  vendorChop.context && vendorChop.context.name, 'Xtreme Lighting Limited');
eq('and the label under it is the vendor side, not the acceptance side',
  vendorChop.context && vendorChop.context.label, 'Authorized Signature(s)');

/* ---------- cue and party on one line ---------- */

const oneLine = mark('signature', 0.300, 0.320, 0.150, 0.045);
attachMarkContext([oneLine], [
  line('Signed for and on behalf of HONG KONG QUALITY ASSURANCE AGENCY', 0.200, 0.640, 0.295),
]);
eq('a cue that carries the party on its own line still resolves',
  oneLine.context && oneLine.context.name, 'HONG KONG QUALITY ASSURANCE AGENCY');

/* ---------- boxes arrive per word, not per line ---------- */

// A text layer reports runs, not lines; OCR reports lines. Both have to work,
// so the same page is fed in word by word.
const perWord = mark('chop', 0.321, 0.721, 0.110, 0.070);
attachMarkContext([perWord], [
  { x: 0.100, y: 0.700, w: 0.055, h: 0.010, text: 'Yours' },
  { x: 0.160, y: 0.700, w: 0.060, h: 0.010, text: 'sincerely' },
  { x: 0.100, y: 0.712, w: 0.070, h: 0.010, text: 'Hong Kong' },
  { x: 0.175, y: 0.712, w: 0.160, h: 0.010, text: 'Telecommunications' },
  { x: 0.340, y: 0.712, w: 0.074, h: 0.010, text: '(HKT) Limited' },
]);
eq('words on one baseline are rejoined into the line they came from',
  perWord.context && perWord.context.name, 'Hong Kong Telecommunications (HKT) Limited');

/* ---------- opt-in: nothing happens without boxes ---------- */

const untouched = mark('chop', 0.321, 0.721, 0.110, 0.070);
attachMarkContext([untouched], null);
ok('no boxes means no context, not a thrown error', !untouched.context);
attachMarkContext([untouched], []);
ok('an empty box list is the same answer', !untouched.context);

/* ---------- the App's half: which of these is us ---------- */

ok('the engine name for our own chop is recognised as ours',
  app.isOurCompanyName(app.normName('Hong Kong Telecommunications (HKT) Limited')));
ok('the counterparty on the same page is not',
  !app.isOurCompanyName(app.normName("Hospital Authority - TWGHS, Int'l Funeral Parlour")));
ok('nor is the vendor on the quotation',
  !app.isOurCompanyName(app.normName('Xtreme Lighting Limited')));
ok('nor is PCCW Digital Solutions, a real counterparty',
  !app.isOurCompanyName(app.normName('PCCW Digital Solutions Limited')));

// What OCR actually returned for these two lines when the sign-off band was
// read off the scanned page -- a lost closing bracket on ours, a split word on
// theirs. Both have to survive the ours/theirs decision, and the bracket is
// the one that breaks it: normName only strips a BALANCED parenthetical, so
// "(HKT" stays glued together and never matches the core name "HKT".
ok('our name with the closing bracket lost to OCR is still ours',
  app.markIsOurs({ context: { name: 'Hong Kong Telecommunications (HKT Limited' } }));
ok('and with the bracket intact',
  app.markIsOurs({ context: { name: 'Hong Kong Telecommunications (HKT) Limited' } }));
ok("the counterparty's name broken the same way is still not ours",
  !app.markIsOurs({ context: { name: "Hospital Authority - TW GHS, Int'l Funeral Parlour" } }));
ok('PCCW Digital Solutions is not us even though PCCW is a core name',
  !app.markIsOurs({ context: { name: 'PCCW Digital Solutions Limited' } }));

eq('markIsOurs reads the context the engine attached',
  app.markIsOurs(hktChop), true);
eq('and leaves the counterparty alone',
  app.markIsOurs(customerChop), false);
eq('a mark with no context is not claimed as ours',
  app.markIsOurs(mark('chop', 0.1, 0.1, 0.1, 0.1)), false);

/* ---------- markCropRect: the picture of one mark, cut from the page ---------- */

// A reviewer asking about a chop is asking whose it is, and the ink never says:
// readChopText returned "0", null, "One Center" and "lons (HK1) Limited 6"
// across the four documents in Demo Data/chop/. So the crop has to carry the
// printed block the name was actually read from. That makes the horizontal
// extent the whole problem, and it is measured, not chosen -- on this very
// page HKT's name line runs x 0.100..0.414 while its own chop is x
// 0.321..0.431, so the name begins 0.221 of the page LEFT of the seal that
// owns it. Padding the mark symmetrically until it reached that name would run
// to x 0.662 and swallow the customer's chop at 0.626.
//
// These run on the same marks attachMarkContext was given above, so what is
// pinned is the whole chain: column -> context -> box -> rect.
{
  const { markCropRect } = globalThis.DocparseEngine;
  const left = markCropRect(hktChop);
  const right = markCropRect(customerChop);
  const rightEdge = r => r.x + r.w;

  ok('the left chop gets a rect at all', !!left, left);
  ok('...that reaches the name printed above it',
    left.x <= 0.100 && left.y <= 0.700, left);
  // Strictly past the ink, not flush with it: CROP_MARGIN is what keeps the
  // seal from being cut off at its own outer edge, which reads as a broken
  // picture rather than as a tight one.
  ok('...and still contains the chop itself, with room around it',
    rightEdge(left) > 0.431 && left.y + left.h > 0.791, left);
  ok('...and stops short of the counterparty chop at x 0.626',
    rightEdge(left) < 0.626, rightEdge(left));

  ok('the right chop reaches its own column\'s name', right.x <= 0.508, right);
  ok('...and does not reach back into the left column\'s name at x 0.414',
    right.x > 0.414, right.x);
  ok('the two crops do not overlap', rightEdge(left) <= right.x,
    { leftEnds: rightEdge(left), rightStarts: right.x });

  // The signature is in the left column too, and handwriting carries no name at
  // all -- the printed block is the ONLY thing that can identify it.
  const sig = markCropRect(hktSignature);
  ok('a signature crop carries the printed name as well', sig.x <= 0.100 && sig.y <= 0.700, sig);

  // No context means the column is unknown. Reaching up by CONTEXT_MAX_ABOVE is
  // best effort; widening sideways on a guess would show the other party's
  // block under this mark's name, which is worse than a tight crop.
  const bare = markCropRect(mark('chop', 0.321, 0.721, 0.110, 0.070));
  ok('an unowned mark still gets a rect', !!bare, bare);
  ok('...which reaches upward toward where a name would be', bare.y < 0.721 - 0.10, bare.y);
  ok('...but is not widened on a guess', bare.w < 0.30, bare.w);

  // Clamped to the page: a mark in the top-left corner must not produce
  // negative offsets, which would draw the crop from outside the canvas.
  const corner = markCropRect(mark('chop', 0, 0, 0.05, 0.05));
  ok('a corner mark clamps to the page', corner.x === 0 && corner.y === 0, corner);
  const far = markCropRect(mark('chop', 0.97, 0.97, 0.05, 0.05));
  ok('...and so does one at the far edge',
    rightEdge(far) <= 1 && far.y + far.h <= 1, far);

  eq('a mark with no bbox has no rect', markCropRect({ kind: 'chop' }), null);
  eq('null in, null out', markCropRect(null), null);

  // context.box is what carries the column, so it has to be attached alongside
  // the name -- a context without it silently falls back to the blind rect.
  ok('attachMarkContext records the box it read the name from', !!hktChop.context.box, hktChop.context);
  ok('...covering the cue line as well as the name',
    hktChop.context.box.y <= 0.700 && hktChop.context.box.x <= 0.100, hktChop.context.box);
}

/* ---------- report ---------- */

console.log(passed + ' passed, ' + failures.length + ' failed');
if (failures.length) {
  failures.forEach(f => console.log('  FAIL  ' + f));
  process.exit(1);
}
