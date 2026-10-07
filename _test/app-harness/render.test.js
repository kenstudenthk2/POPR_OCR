// Render smoke test: does the changed UI actually run?
//
//   node _test/app-harness/render.test.js
//
// crosscheck.test.js exercises the pure functions with React stubbed out, which
// proves the verdicts are right and proves nothing at all about the components
// that draw them. This renders the real tree with the real React, so a typo in
// JSX, a prop that no longer arrives, or a field row reaching for something the
// crosscheck does not carry fails here instead of in front of the reviewer.
//
// renderToStaticMarkup, not a DOM: effects never run, which is the point --
// every effect in this file is object-URL and keyboard plumbing that needs a
// browser. What it does cover is the render pass, where all the changes are.
//
// Rewritten after the upload/parse redesign moved things: page 1's editable
// field grid became a read-only panel, so the ring / flag / capsule assertions
// that used to run against UploadPage now run against renderFieldInput itself,
// which is what the document viewer's "Extracted Field" tab renders. Where the
// page deliberately no longer says something, that is asserted too rather than
// quietly dropped.

const { load, demoClone, setDemoField } = require('./app.js');
const { renderToStaticMarkup } = require('react-dom/server');
const React = require('react');

const app = load({ react: true });
const stub = load(); // for the pure helpers, which do not care

let passed = 0;
const failures = [];

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
function ok(label, cond, detail) {
  if (cond) { passed++; return; }
  failures.push(label + (detail === undefined ? '' : '\n      got: ' + JSON.stringify(detail).slice(0, 400)));
}

const noop = () => {};
function pipeline(attachments, overrides) {
  const diffs = app.computeFieldDiffs(attachments, 0);
  const census = app.roleCensus(attachments, overrides || {});
  return { diffs, census, crosschecks: app.computeCrosschecks(diffs, census) };
}

/* ---------- the whole page, on the shipped demo ----------
   The demo carries two deliberate disagreements (see the demo-data note in the
   App): `hkd` conflicts and `vendor` is softened. Everything else agrees. */

const demo = app.DEMO_ATTACHMENTS;
const base = pipeline(demo);
const fields = app.initialFormState(true);

const uploadProps = {
  attachments: demo, setAttachments: noop, activeTab: 'Vendor Quotation', setActiveTab: noop,
  fields, setField: noop, setFieldAuto: noop, applyMatches: noop, applyUid: noop, detectFromRoles: noop,
  goProcess: noop, goVerify: noop, demoMode: true, toggleDemo: noop, openViewer: noop,
  crosschecks: base.crosschecks, dismissedDiffs: new Set(), toggleDismissDiff: noop,
  itemIndex: 0, setItemIndex: noop, selectItem: noop, resetRecordData: noop,
  census: base.census, autoCensus: app.roleCensus(demo), roleOverrides: {}, setRoleOverrides: noop,
};
const uploadHtml = renders('UploadPage renders', React.createElement(app.UploadPage, uploadProps));

ok('the role bar names the remaining slots',
  ['Agreement', 'ATQ (Excel)', 'Quotation'].every(l => uploadHtml.includes(l)));
ok('and no longer offers a Customer PO slot', !uploadHtml.includes('Customer PO'));
ok('the role bar omits ATQ PDF', !uploadHtml.includes('ATQ (PDF)'));
ok('the extracted-field panel is present', uploadHtml.includes('Extracted Fields'));
ok('and reads out the values the form is holding', uploadHtml.includes('ABC Company Ltd'));
ok('the legend explains the green', uploadHtml.includes('Green = auto-extracted'));
ok('the item strip names the item being read', uploadHtml.includes('Item 1'));

// The Start button (renamed from "Send to n8n") now lives under the Source /
// role selector panel, inside PrpoExtractedFieldsCard, rather than the top
// bar -- moved there deliberately so it sits beside the role slots it reads
// and bottom-aligns with the Document Viewer next to it. It is gated on the
// ROLE SLOTS and on there being actual bytes behind them -- not on
// parsedCount, and not on the document viewer's selection. Three states, and
// the titles are what separates them: a button that came up disabled for the
// wrong reason looks identical to one that is simply not pressed yet. The
// seeded demo is the middle case on purpose: it has role slots and no files
// behind them, so it must not be offered as sendable.
ok('the role selector column offers Start', uploadHtml.includes('>Start<'));
ok('the demo, whose fixtures carry no file bytes, says so rather than sending nothing',
  uploadHtml.includes('carry no file to send'));
ok('and does not tell the reviewer to assign a role they have already assigned',
  !uploadHtml.includes('Assign a document to a role slot first'));

// The same page with nothing uploaded at all: PrpoExtractedFieldsCard (the
// Document Viewer, the role selector, and now the Start button that sits
// under it) is gated on parsedCount > 0, so with nothing uploaded none of that
// unit exists to be disabled -- the giant upload dropzone is the whole page
// instead. This is a real behaviour change from when the button lived in the
// top bar unconditionally (it used to stay and explain itself); it is now
// consistent with the Edit-roles button and the rest of the role-slot UI it
// sits beside, which were already gated the same way.
const emptyPipeline = pipeline(app.EMPTY_ATTACHMENTS);
const emptyHtml = renders('UploadPage renders with nothing uploaded',
  React.createElement(app.UploadPage, Object.assign({}, uploadProps, {
    attachments: app.EMPTY_ATTACHMENTS, demoMode: false,
    fields: app.initialFormState(false),
    census: emptyPipeline.census, autoCensus: app.roleCensus(app.EMPTY_ATTACHMENTS),
    crosschecks: emptyPipeline.crosschecks,
  })));
ok('an empty page shows the upload dropzone instead of a Start button',
  emptyHtml.includes('Drop Email / Documents here') && !emptyHtml.includes('>Start<'));

// And with bytes behind the slots -- the only state in which the POST can
// actually happen. The clone is the demo with a blob stamped on every document,
// which is what a real upload leaves behind (parseFile is called with
// retainForResume: true).
const withBytes = demoClone(app);
Object.keys(withBytes).forEach(typeKey => {
  (withBytes[typeKey].docs || []).forEach(d => { d.blob = { sentinel: typeKey + '#' + d.index }; });
});
const bytesPipeline = pipeline(withBytes);
const bytesHtml = renders('UploadPage renders with real bytes behind the slots',
  React.createElement(app.UploadPage, Object.assign({}, uploadProps, {
    attachments: withBytes, census: bytesPipeline.census,
    autoCensus: app.roleCensus(withBytes), crosschecks: bytesPipeline.crosschecks,
  })));
ok('a pile with files behind its role slots offers a live Send',
  bytesHtml.includes('Post the documents in the role slots'));
ok('and names the roles it would post, so the reviewer can see what leaves',
  bytesHtml.includes('Agreement') && bytesHtml.includes('Quotation'));

// Page 1's editable field grid — rings, ⚠ marks, capsules, compare panel — was
// taken out in the upload/parse redesign: the panel here is read-only, and
// renderFieldInput (which still draws all of it) now runs in the document
// viewer's "Extracted Field" tab and nowhere else on this page. Asserted rather
// than assumed, because it is a real change in where a reviewer is told two
// documents disagree, and a future change putting it back should have to say so
// here. The markers themselves are covered further down, on the row itself.
const rings = html => (html.match(/ring-1 ring-\[#B78312\]/g) || []).length;
ok('page 1 draws no conflict ring of its own', rings(uploadHtml) === 0, rings(uploadHtml));
ok('the demo\'s deliberate hkd conflict is still a conflict, wherever it is drawn',
  base.crosschecks.hkd.severity === 'different', base.crosschecks.hkd.severity);
ok('and the softened vendor is still softened',
  base.crosschecks.vendor.severity === 'similar', base.crosschecks.vendor.severity);

const verifyProps = {
  attachments: demo, fields, manualChecks: [true, true, true, true], toggleManualCheck: noop,
  goUpload: noop, goSave: noop, demoMode: true, census: base.census, itemRecordIds: [], saveStatus: null, saving: false,
  crosschecks: base.crosschecks, dismissedDiffs: new Set(), toggleDismissDiff: noop, openViewer: noop,
};
const verifyHtml = renders('VerifyPage renders', React.createElement(app.VerifyPage, verifyProps));
ok('Verify names the pair it compared', verifyHtml.includes('vs') || verifyHtml.includes('Agrees across'));
// Same two glyphs as the field row, for the same two facts -- that is the whole
// reason FieldCrossCheck picked ≈ over a second ≠.
ok('Verify marks a passing check with ✓', verifyHtml.includes('✓'));
ok('and grades its pairs with ≈ and ≠',
  verifyHtml.includes('≈') && verifyHtml.includes('≠'));
ok('its navigation keeps its arrows',
  verifyHtml.includes('←') && verifyHtml.includes('→'));
// The green on "Reference numbers" covers four keys, and ATQ Ref. No. is
// reported by the ATQ slot alone. A passing group must not quietly absorb a
// field nothing corroborated.
ok('a green group still owns up to its uncorroborated field',
  verifyHtml.includes('not cross-checked'), verifyHtml.match(/Reference numbers[\s\S]{0,300}/));

/* ---------- the same page with a real disagreement ---------- */

const broken = setDemoField(demoClone(app), 'Contract', 'Customer Name', 'XYZ Holdings Ltd');
const bad = pipeline(broken);
const badHtml = renders('UploadPage renders a disagreement',
  React.createElement(app.UploadPage, Object.assign({}, uploadProps,
    { attachments: broken, crosschecks: bad.crosschecks, census: bad.census })));
// Same page, one document now contradicting the rest, and page 1 says nothing
// about it -- the read-only panel reads the form, not the documents. Verify and
// the viewer are where the reviewer is told; both are covered below.
ok('page 1 renders a contradicting upload without a conflict mark of its own',
  rings(badHtml) === 0, rings(badHtml));
ok('the contradiction itself was detected', bad.crosschecks.customerName.severity === 'different',
  bad.crosschecks.customerName.severity);

const badVerify = renders('VerifyPage renders a disagreement',
  React.createElement(app.VerifyPage, Object.assign({}, verifyProps,
    { attachments: broken, crosschecks: bad.crosschecks, census: bad.census })));
ok('Verify does not name ATQ PDF', !badVerify.includes('ATQ (PDF)'));

// A conflict on a field two of the four roles never mention: the row has to say
// who sat it out, and say that a missing optional PO is not a failure.
const period = setDemoField(demoClone(app), 'Contract', 'Contract Start Date', '01/06/2026');
const periodCc = pipeline(period);
const periodVerify = renders('VerifyPage renders a partly-silent conflict',
  React.createElement(app.VerifyPage, Object.assign({}, verifyProps,
    { attachments: period, crosschecks: periodCc.crosschecks, census: periodCc.census })));
ok('Verify says which roles could not take part', periodVerify.includes('Not cross-checked'),
  periodVerify.match(/Contract period[\s\S]{0,400}/));
ok('and names the silent ones', periodVerify.includes('does not mention it'));

/* ---------- ProcessingPage: the Upload/Verify transition ----------
   goProcess itself (which documents to resume, the demo-mode short circuit,
   the resumeDeferredOcr vs. eager-parseFile branch) is a closure inside App
   and not reachable through this static-render harness -- same ceiling
   detectFromRoles hit in Phase 4. What's testable here is the page it drives
   to: does it show progress, and does a failure leave a way out. */

const processingHtml = renders('ProcessingPage renders while reading',
  React.createElement(app.ProcessingPage, { status: 'Reading Contract…', error: null, retry: noop, goVerify: noop }));
ok('it shows the in-progress status', processingHtml.includes('Reading Contract…'));
ok('and no error styling', !processingHtml.includes('Could not finish reading'));

const processingErrorHtml = renders('ProcessingPage renders a resume failure',
  React.createElement(app.ProcessingPage, { status: '', error: 'Attachment timed out', retry: noop, goVerify: noop }));
ok('it names the failure', processingErrorHtml.includes('Attachment timed out'));
ok('and offers a way out that is not stuck', processingErrorHtml.includes('Continue to Verify anyway'));
ok('and a way to try again', processingErrorHtml.includes('Retry'));

/* ---------- the comparison panel, opened ---------- */

const cc = bad.crosschecks.customerName;
const panelHtml = renders('FieldComparePanel renders',
  React.createElement(app.FieldComparePanel, {
    cc, currentValue: 'ABC Company Ltd', canAdopt: true,
    onOpen: noop, onUse: noop, onDismiss: noop, dismissed: false,
  }));
ok('the panel lists every remaining role, silent ones included',
  ['Agreement', 'ATQ (Excel)', 'Quotation'].every(l => panelHtml.includes(l)));
ok('and the panel has no Customer PO row', !panelHtml.includes('Customer PO'));
ok('the panel omits ATQ PDF', !panelHtml.includes('ATQ (PDF)'));
ok('it offers to adopt a value', panelHtml.includes('>use<'));
ok('and closes with the verdict in words', panelHtml.includes('differs'));

/* ---------- the role editor's selects carry documents, not "Auto" ---------- */

// The "Auto — <file>" row named the same document the list below it already
// named, under a second value ("") meaning something else, so the picker showed
// one file twice. Each select now opens on the document the role is actually
// reading from. The failure this pins is silent: a select whose value matches no
// option renders with the FIRST option showing, which looks like a deliberate
// pick of the wrong document.
const editorHtml = renders('RoleAssignmentEditor renders',
  React.createElement(app.RoleAssignmentEditor, {
    census: base.census, autoCensus: app.roleCensus(demo), onSave: noop, onCancel: noop,
  }));
ok('no Auto row survives anywhere in the editor', !/Auto/.test(editorHtml), editorHtml.slice(0, 300));
ok('and no empty-valued option is offered when something was detected',
  !editorHtml.includes('<option value="">'));

// Which option each select opens on. renderToStaticMarkup marks it with
// selected="" on the option itself, so this reads the rendered answer rather
// than re-deriving it from the census the component was handed.
const selectedIn = html => html.split('</select>').slice(0, -1).map(chunk => {
  const sel = chunk.slice(chunk.lastIndexOf('<select'));
  const m = /<option[^>]*selected=""[^>]*>([^<]*)</.exec(sel);
  return m ? m[1].trim() : null;
});
const picked = selectedIn(editorHtml);
ok('three selects, one per role', picked.length === 3, picked);
ok('Agreement opens on the detected agreement',
  picked[0] === 'Contract-signed.pdf (Contract)', picked[0]);
ok('ATQ opens on the workbook, the source its column reads',
  picked[1] === 'ATQ-202604-00177.xlsx (Excel)', picked[1]);
ok('Quotation opens on the detected quotation',
  picked[2] === 'VQ-2026-1847.pdf (Vendor Quotation)', picked[2]);

// Prefilling from auto-detection means the draft differs from the stored
// overrides ({}) on the very first render. Comparing the two would report
// Unsaved before the reviewer touched a thing.
ok('opening the editor does not claim unsaved changes', !editorHtml.includes('Unsaved'));

// The one case that still needs an empty-valued option: nothing detected for a
// role at all. Without it the select falls back to showing the first document.
const nothing = { assigned: { agreement: null, atq: null, quotation: null }, docs: [], overrides: {} };
const emptyEditor = renders('RoleAssignmentEditor with nothing detected',
  React.createElement(app.RoleAssignmentEditor, {
    census: Object.assign({}, base.census, { overrides: {} }), autoCensus: nothing,
    onSave: noop, onCancel: noop,
  }));
ok('an undetected role says so rather than pointing at a document',
  emptyEditor.includes('Nothing detected'));
ok('and there are as many of those as undetected roles',
  (emptyEditor.match(/Nothing detected/g) || []).length === 3,
  (emptyEditor.match(/Nothing detected/g) || []).length);

/* ---------- the conflict markers, where they now live ----------
   renderFieldInput draws the ring, the flag button, the capsules and the
   compare toggle. Page 1 no longer calls it (see above); the document viewer's
   "Extracted Field" tab does. Driven directly here rather than through the
   viewer, which needs object URLs and effects this harness cannot run.

   The demo supplies all three verdicts at once: hkd conflicts, customerName
   agrees, vendor is softened. */

const markerCtx = {
  fields, crosschecks: base.crosschecks, dismissedDiffs: new Set(), setField: noop,
  onDissent: noop, onSource: noop, expandedKey: null, onToggleExpand: noop, onDismiss: noop,
};
const defOf = key => app.FIELD_DEFS.find(d => d[0] === key);
const rowFor = (key, ctx) => renders('renderFieldInput renders ' + key,
  React.createElement('div', null, app.renderFieldInput(defOf(key), ctx || markerCtx, 'w-full')));

const hkdRow = rowFor('hkd');
ok('a conflicting field is ringed', hkdRow.includes('ring-1 ring-[#B78312]'));
ok('and carries a flag that opens the odd one out', hkdRow.includes('odd one out'));
ok('its capsules are split, the dissenting one in amber', hkdRow.includes('divide-[#B78312]'));
ok('and a compare toggle is offered', hkdRow.includes('>compare<'));

const agreeRow = rowFor('customerName');
ok('an agreeing field draws a joined green capsule', agreeRow.includes('divide-[#9FD9B8]'));
ok('and is not ringed', !agreeRow.includes('ring-1 ring-[#B78312]'));

const softRow = rowFor('vendor');
ok('a softened field is not ringed either', !softRow.includes('ring-1 ring-[#B78312]'));
ok('and does not draw the amber split', !softRow.includes('divide-[#B78312]'));

// The glyphs themselves. Agreement is meant to be carried by enclosure and by a
// character, not by colour alone -- a reviewer who cannot tell #3D8B5F from
// #B78312 reads the row off ✓ / ≈ / ≠. The upload/parse redesign flattened all
// of them to hyphens and "OK" (and mojibake'd one middot), which no assertion
// then caught, so they are asserted one by one here and never as "some
// non-ASCII character is present".
ok('the flag on a conflicting field is ⚠', hkdRow.includes('⚠'));
ok('a hard split is separated by ≠', hkdRow.includes('≠'));
ok('an agreeing capsule is led by ✓', agreeRow.includes('✓'));
ok('a softened split is separated by ≈, not ≠',
  softRow.includes('≈') && !softRow.includes('≠'));

// Dismissing a conflict clears the mark without changing the verdict.
const dismissedCtx = Object.assign({}, markerCtx,
  { dismissedDiffs: new Set([base.crosschecks.hkd.dismissKey]) });
const dismissedRow = rowFor('hkd', dismissedCtx);
ok('a dismissed conflict loses its ring', !dismissedRow.includes('ring-1 ring-[#B78312]'));
ok('but is still a conflict underneath', base.crosschecks.hkd.severity === 'different');

/* ---------- the field row on its own, both call shapes ---------- */

const rowCtx = {
  fields, crosschecks: bad.crosschecks, dismissedDiffs: new Set(), setField: noop,
  onDissent: noop, onSource: noop, expandedKey: 'customerName', onToggleExpand: noop, onDismiss: noop,
};
const rowHtml = renders('renderFieldInput renders with its panel open',
  React.createElement('div', null,
    app.renderFieldInput(['customerName', 'Customer Name', '', true], rowCtx, 'w-full')));
ok('the expanded row contains the panel', rowHtml.includes('Document') && rowHtml.includes('Says'));

// A field key with no crosscheck at all must still render -- most of the
// twenty-nine are not compared.
const plain = renders('renderFieldInput renders an uncompared field',
  React.createElement('div', null,
    app.renderFieldInput(['handledBy', 'Handled By', '', false], rowCtx, 'w-full')));
ok('and draws no capsules for it', !plain.includes('divide-x'));

/* ---------- the source file's own typography ----------
   Read as text rather than through a render, because the flattening that
   prompted this hit strings no fixture reaches: status messages, button
   labels, empty-cell placeholders. It also left one visible mojibake
   ("v2 蝜?SB Back-to-Back" where "v2 · SB Back-to-Back" belongs), which is the
   cheapest possible thing to check for and was never checked for. */

const appSource = require('fs').readFileSync(require('./app.js').APP_PATH, 'utf8');

ok('the file carries no replacement character', !/�/.test(appSource),
  (appSource.match(/.{0,40}�.{0,20}/) || [])[0]);
['✓', '⚠', '≠', '≈', '—', '→', '←', '·', '…'].forEach(g => {
  ok('the file still uses ' + g, appSource.includes(g));
});
ok('no field row falls back to an ASCII flag', !appSource.includes('>{"!"}</button>'));
ok('no ternary has two identical branches -- the shape a flattened pair leaves',
  !/\?\s*"([^"]+)"\s*:\s*"\1"/.test(appSource),
  (appSource.match(/\?\s*"([^"]+)"\s*:\s*"\1"/) || [])[0]);

/* ---------- one upload writes ONE record: the Verify page's half ---------- */

// TEMPORARY behaviour. planSavesForItem (recordid.test.js) pins that Save
// builds one plan; this pins that the page SAYS so and that the button stops
// letting a second one through. Both halves, because a lock the reviewer cannot
// see reads as a bug, and a message with a live button behind it is worse.
{
  const multi = [{ recordId: 'ATQ-1-2', collided: false }, { recordId: 'ATQ-1-3', collided: false }];
  const ready = renders('VerifyPage with two items, nothing saved yet',
    React.createElement(app.VerifyPage, Object.assign({}, verifyProps, { itemRecordIds: multi, itemIndex: 0 })));
  ok('a two-item ATQ says how many items it covers', ready.includes('This ATQ covers 2 items'));
  ok('...and names the one record Save will write', ready.includes('ATQ-1-2'));
  ok('...and says the other item needs its own email', ready.includes('item needs its own email'));
  // The opening tag of the button whose label is `label` -- checked rather than
  // searching the page for "disabled", which any other control could supply.
  const buttonTag = (html, label) => {
    const i = html.indexOf(label);
    if (i < 0) return '';
    const s = html.lastIndexOf('<button', i);
    return s < 0 ? '' : html.slice(s, html.indexOf('>', s) + 1);
  };
  ok('Save is still live before anything is saved', ready.includes('Next: Save'));
  ok('...and the notice alone does not disable it',
    buttonTag(ready, 'Next: Save').indexOf('disabled') < 0, buttonTag(ready, 'Next: Save'));

  const saved = renders('VerifyPage after this upload saved its one record',
    React.createElement(app.VerifyPage, Object.assign({}, verifyProps,
      { itemRecordIds: multi, itemIndex: 0, savedRecordId: 'ATQ-1-2' })));
  ok('the saved id is named, not just "saved"', saved.includes('Saved ATQ-1-2'));
  ok('switching tab is explicitly ruled out', saved.includes('will not save again'));
  ok('...and the reviewer is told what to do instead', saved.includes('+ New Record'));
  ok('the Save button no longer offers to save', !saved.includes('Next: Save'));
  ok('...it reports the state with the same ✓ the rest of the app uses',
    saved.includes('✓ Saved'));
  ok('...and that button is disabled, so the lock is not advice',
    buttonTag(saved, '✓ Saved').indexOf('disabled') >= 0, buttonTag(saved, '✓ Saved'));
  // PrimaryButton takes only children/onClick/disabled/className, so a title=
  // on it is dropped without a word. Pinned so nobody re-adds one and believes
  // the reason is on screen when it is not.
  ok('no dead title= on the Save button -- PrimaryButton would swallow it',
    buttonTag(saved, '✓ Saved').indexOf('title') < 0, buttonTag(saved, '✓ Saved'));

  // A one-item ATQ has nothing to warn about: itemRecordIds is [] there, and a
  // notice saying "this ATQ covers 0 items" would be worse than silence.
  const single = renders('VerifyPage on a single-item ATQ',
    React.createElement(app.VerifyPage, Object.assign({}, verifyProps, { itemRecordIds: [] })));
  ok('a single-item upload draws no multi-item notice', !single.includes('This ATQ covers'));
  ok('...and its Save button is untouched', single.includes('Next: Save'));
}

/* ---------- opening the viewer on ONE document ---------- */

// The Verify Table's column header names one file and the column beneath it
// answers from that file alone, so the viewer it opens lists that file and no
// other -- offering the siblings invites checking a number against a document
// that never reported it. `only` is optional and defaults to the old
// behaviour, because a chip or a field row genuinely does want the whole list:
// the reviewer is browsing from there.
//
// The demo fixture has one document per entry, so the narrowing needs an entry
// built here. Three documents is the smallest count where "all" and "only" can
// be told apart from the count alone.
{
  const doc = (i, f) => ({ index: i, fileName: f, previewKind: 'pdf', blob: { size: 1 }, fields: [], textLines: null });
  const many = demoClone(app);
  // `self` and a page with `lines` are what make selfDocFor return an email
  // body. Without one the viewer resolves a stray index to nothing and renders
  // nothing at all, which would make the stray-index assertion below compare
  // two empty strings and pass for the wrong reason.
  many.Contract = { parsed: true, file: 'mail.msg', blob: { size: 1 }, text: 'x',
    self: { fileName: 'mail.msg', ext: 'msg', mimeType: '', size: 1, blob: { size: 1 }, previewKind: 'text' },
    docs: [doc(0, 'Contract-signed.pdf'), doc(1, 'Annex-A.pdf'), doc(2, 'Cover-letter.pdf')],
    rawFields: [], pages: [{ lines: ['body text'] }], signing: null, records: null };
  const manyBase = stub.computeCrosschecks(
    stub.computeFieldDiffs(many, 0),
    stub.roleCensus(many, null, stub.offItemQuotationTest(many, 0)));
  const viewerProps = {
    attachments: many, onClose: noop, crosschecks: manyBase, dismissedDiffs: new Set(),
    toggleDismissDiff: noop, setField: noop, fields, openViewer: noop,
    census: stub.roleCensus(many, null, stub.offItemQuotationTest(many, 0)),
  };
  const view = (label, viewer) => renders(label,
    React.createElement(app.DocumentViewer, Object.assign({ viewer }, viewerProps)));
  const listed = h => { const m = h.match(/DOCUMENTS IN THIS [A-Z]+ \((\d+)\)/); return m ? Number(m[1]) : -1; };

  const all = view('DocumentViewer lists every document by default',
    { typeKey: 'Contract', docIndex: 0, page: 1 });
  ok('without `only` the whole pile is listed', listed(all) === 3, listed(all));
  ok('...including the siblings of the open one', all.includes('Annex-A.pdf'), listed(all));

  const one = view('DocumentViewer opened on one document',
    { typeKey: 'Contract', docIndex: 0, page: 1, only: true });
  ok('`only` lists exactly one', listed(one) === 1, listed(one));
  ok('...the one asked for', one.includes('Contract-signed.pdf'), listed(one));
  ok('...and not its siblings',
    !one.includes('Annex-A.pdf') && !one.includes('Cover-letter.pdf'), listed(one));

  // The narrowing follows the index, not the position -- a header opening the
  // second attachment must not silently show the first.
  const second = view('DocumentViewer opened on the second document',
    { typeKey: 'Contract', docIndex: 1, page: 1, only: true });
  ok('`only` on index 1 still lists one', listed(second) === 1, listed(second));
  ok('...and it is index 1\'s file',
    second.includes('Annex-A.pdf') && !second.includes('Cover-letter.pdf'), listed(second));

  // An index the entry does not have would narrow the list to nothing, leaving
  // a picker with no rows beside a preview that still resolved. Falling back to
  // the whole list is the same thing the viewer already does for the preview.
  const stray = view('DocumentViewer with `only` on an index that is not there',
    { typeKey: 'Contract', docIndex: 7, page: 1, only: true });
  const strayAll = view('...and the same index without `only`',
    { typeKey: 'Contract', docIndex: 7, page: 1 });
  // Both must actually render something -- the fixture's email body is what
  // guarantees that, and without the check this pair would compare two empty
  // strings and pass however the narrowing behaved.
  ok('the stray-index fixture renders at all', stray.length > 0 && strayAll.length > 0,
    { stray: stray.length, strayAll: strayAll.length });
  ok('...and lists the documents rather than an empty picker', listed(stray) === 3, listed(stray));
  ok('an index that is not in the list is not narrowed to an empty picker',
    stray === strayAll, { stray: listed(stray), strayAll: listed(strayAll) });

  // Two call sites opt into the single-document (`true`) form: the Verify
  // Table's single Value column header (always the ATQ Excel), and
  // openDocButton's own non-Quotation branch (Agreement/ATQ narrow to one
  // file, same as always). Every other caller -- field rows, chips, the chop
  // View link -- omits the argument and keeps the full list.
  const optIns = (appSource.match(/openViewer\([^)]*,\s*true\)/g) || []);
  ok('exactly two places unconditionally ask for the single-document view', optIns.length === 2, optIns);
  ok('...the Verify Table column header',
    optIns.some(s => s.includes('valueSrc.typeKey')), optIns);
  ok('...and openDocButton\'s non-Quotation branch',
    optIns.some(s => s.includes('csrc.typeKey')), optIns);
  // Both former per-row opt-ins (the n8n Cross Check source button and the
  // breakdown panel opened from a flagged value) go through openDocButton,
  // which special-cases Quotation -- Quotation can carry extra documents the
  // reviewer added by hand (extraQuotationDocs), so its narrowing is a SET of
  // picked documents rather than one file, and every other role still
  // narrows to one as before.
  ok('...the n8n Cross Check source button and the breakdown panel both use openDocButton',
    /openDocButton\(csrc, row\.sourceRole\)/.test(appSource) &&
    /openDocButton\(csrc, c\.roleKey\)/.test(appSource) &&
    appSource.includes('crossCheckSourceLabel(row)'));
  // Quotation's own opt-in narrows to the SET of docs actually picked (the
  // primary plus its extras), not to one file and not to the whole tab.
  ok('...and Quotation narrows to its own picked documents, not the whole tab',
    /if \(roleKey === "quotation"\)/.test(appSource) &&
    /extraQuotationDocs\(census\)/.test(appSource));

  // App's openViewer is a useCallback inside a component the harness cannot
  // mount, so the wiring between the argument and the viewer state is checked
  // on the source. Without this, dropping `only` from setViewer leaves every
  // component test green while the button silently stops narrowing anything.
  // `only` now carries either a boolean (one document) or an array (a picked
  // set, e.g. Quotation's primary + extras) through to the viewer state.
  ok('openViewer forwards the flag into the viewer state, array or boolean',
    /setViewer\(\{[^}]*only:\s*Array\.isArray\(only\)\s*\?\s*only\s*:\s*!!only[^}]*\}\)/.test(appSource),
    (appSource.match(/setViewer\(\{[^}]*\}\)/) || [])[0]);

  ok('non-PDF previews receive zoom controls',
    /function PreviewZoomControls/.test(appSource) &&
    /HtmlFramePreview html=\{wrapSheetHtml\(sheets\[i\]\.html\)\} title=\{doc\.fileName\} zoom=\{zoom\}/.test(appSource) &&
    /ImagePreview url=\{url\} name=\{doc\.fileName\} zoom=\{zoom\}/.test(appSource) &&
    /TextPreview lines=\{doc\.textLines\} zoom=\{zoom\}/.test(appSource),
    'missing zoom wiring for sheet/image/text previews');
}

/* ---------- the workbench header, and the Verify Table's own column ---------- */

{
  // The box takes the whole request, not the tab it happens to be sitting on:
  // an email carries every role at once, so naming one of them there told the
  // reviewer to sort the attachments before dropping them.
  ok('the drop box asks for the email or the documents',
    emptyHtml.includes('Drop Email / Documents here'));
  ok('...and no longer names the tab it is on',
    !emptyHtml.includes('Drop Vendor Quotation here'));

  // Process runs the deferred OCR in this browser instead of handing the
  // documents to n8n, so outside admin mode it is WITHHELD, not disabled -- a
  // greyed button with no explanation reads as "broken", not as "not yours".
  ok('a reviewer without admin is not offered Process',
    !uploadHtml.includes('Process</span>'), uploadHtml.indexOf('Process</span>'));
  const adminUpload = renders('UploadPage in admin mode',
    React.createElement(app.UploadPage, Object.assign({}, uploadProps, { adminMode: true })));
  ok('...and admin mode is', adminUpload.includes('Process</span>'));

  // The Verify Table is ExtractedFieldsPage, not VerifyPage -- the LIS column,
  // the Cross Check column and the row-status icons all live there.
  const verifyTableProps = {
    attachments: demo, crosschecks: base.crosschecks, census: base.census, itemIndex: 0,
    goLis: noop, openViewer: noop, uid: 'UID-26-04-0143-10', recordId: 'ATQ-1',
    emailSubject: null, dataverseVerify: null, refreshDataverse: null,
    dismissedDiffs: new Set(), toggleDismissDiff: noop,
  };
  const table = renders('the Verify Table renders',
    React.createElement(app.ExtractedFieldsPage, verifyTableProps));
  // n8n mode is the other half of the same page, and the Cross Check badges are
  // only drawn there.
  const n8nTable = renders('the Verify Table renders in n8n mode',
    React.createElement(app.ExtractedFieldsPage, Object.assign({}, verifyTableProps,
      { dataverseVerify: { source: 'n8n', status: 'ready', rows: {} }, refreshDataverse: noop })));

  // The "Pair" button (FEATURES.verifyCodePair) and coding fields
  // (Charge CCC, Account Code, Works Order Code) were removed from Verify Table.
  ok('the Pair button is NOT drawn beside Product Type', !table.includes('>Pair</button>'));
  ok('...in n8n mode too', !n8nTable.includes('>Pair</button>'));
  ok('Charge CCC is removed from Verify Table', !table.includes('Charge CCC LIS value'));
  ok('Account Code is removed from Verify Table', !table.includes('Account Code LIS value'));
  ok('Works Order Code is removed from Verify Table', !table.includes('Works Order Code LIS value'));
  ok('Issue By is removed from Verify Table', !table.includes('Issue By LIS value'));

  // The LIS column is the reviewer's own answer. The two buttons beside it are
  // shortcuts, so the cell itself has to take typing.
  const lisInputs = html => (html.match(/aria-label="[^"]*LIS value"/g) || []).length;
  ok('every LIS cell is an input, not a read-only span', lisInputs(table) > 10, lisInputs(table));
  ok('...in n8n mode too', lisInputs(n8nTable) > 10, lisInputs(n8nTable));
  // Chop / Sign Detection, Company Chop and Chop Reminder are the three
  // exceptions -- none of them carries a LIS input, just a plain right-aligned
  // cell, since none of the three is a value the reviewer types into the LIS.
  ok('...except Chop / Sign Detection, Company Chop and Chop Reminder, which stay blank cells',
    !table.includes('Chop / Sign Detection LIS value') &&
    !table.includes('Company Chop LIS value') &&
    !table.includes('Chop Reminder LIS value'));
  // Clearing a cell has to STAY cleared. `selectedLisValues[id] || lisCellValue(...)`
  // refills from Dataverse the moment the box is emptied, which looks like a bug
  // in the box rather than a policy about the column.
  ok('an emptied LIS cell is an own property, not a falsy miss',
    /hasOwnProperty\.call\(selectedLisValues, row\.id\)/.test(appSource));
  // A typed value under a still-highlighted "Selected" button would claim to
  // have come from a document it was never in.
  ok('typing hands the row back to the reviewer', /\[rowId\]: "manual"/.test(appSource));

  // LisRemarkPage's own Excel row preview: every one of the 33 destination
  // columns has to be an input a reviewer can type into (same reasoning as
  // the Verify Table's LIS column above), not a read-only span that only
  // shows what OCR already found.
  const lisRemarkProps = {
    fields, lisRowValues: {}, attachments: demo, itemIndex: 0, selectItem: noop,
    goUpload: noop, goSave: noop, saving: false, savedRecordId: '', setField: noop,
  };
  const lisRemarkHtml = renders('LisRemarkPage renders',
    React.createElement(app.LisRemarkPage, lisRemarkProps));
  // Scoped to the spreadsheet cells by their own placeholder, not to "every
  // input with an aria-label on this page": the To Supplier Remark card once
  // carried two labelled date inputs of its own (the PO Period, since removed)
  // and a loose match counted those as Excel columns. The scoping stays --
  // the next control added to that card would walk into the same trap.
  const excelPreviewInputs = html => (html.match(/<input[^>]*placeholder="Blank"[^>]*aria-label="[^"]*"/g) || []);
  ok('every Excel row preview cell (33 columns split across the two half-tables) is an editable input',
    excelPreviewInputs(lisRemarkHtml).length === app.EXCEL_COLUMN_MAP.length,
    excelPreviewInputs(lisRemarkHtml).length);
  ok('a filled cell carries its current value on the input, not as static text',
    lisRemarkHtml.includes('value="ABC Company Ltd"'));
  ok('a blank cell reads Blank as a placeholder, not frozen display text',
    /<input[^>]*placeholder="Blank"[^>]*value=""/.test(lisRemarkHtml));

  // The two remark pickers stand in a row of their own above the remark cards
  // (dev side, FEATURES.remarkPickersAbove), and that row has to OUT-STACK the
  // cards below it. Card carries `panel-rise`, whose animation is filled
  // `both` and ends on `transform: translateY(0)` -- a non-`none` transform,
  // so EVERY Card is its own stacking context and the open dropdown's own
  // z-20 cannot escape the card it was opened in. The remark cards come later
  // in the DOM, so they painted over the expanded list. The row's own
  // `relative z-30` is what lifts the whole subtree above them; a z-index on
  // the panel can never fix this from inside.
  const pickerRow = (lisRemarkHtml.match(/<div class="[^"]*"[^>]*>(?=<div class="panel-rise[^"]*">(?:(?!<\/div>).)*Sales Name :)/) || [])[0] || '';
  ok('the two remark pickers are drawn above the remark cards', pickerRow !== '');
  ok('...and that row is positioned, so a z-index on it applies at all',
    /relative/.test(pickerRow), pickerRow);
  ok('...and it out-stacks the remark Cards below, each of which is its own stacking context',
    /z-30/.test(pickerRow), pickerRow);
  ok('...and both pickers really are in it',
    lisRemarkHtml.includes('Sales Name :') && lisRemarkHtml.includes('Admin Name :'));

  // A row with MORE cells than the header has grows the table a phantom last
  // column, and that column eats the slack: every LIS cell above it then stops
  // short of the card's right edge while the header label still sits at the
  // edge, which reads as "the column is misaligned" rather than as "one row has
  // an extra cell". Measured in Chrome on the real page: the phantom column took
  // 315px of 1418. The Company Chop row is the one that can drift, since it is
  // drawn outside the row map and nothing else counts its cells.
  const cellCounts = html => {
    const chunks = html.split(/<tr[\s>]/).slice(1);
    const headCells = (chunks[0].match(/<th[\s>]/g) || []).length;
    const rows = chunks.map(c => (c.match(/<td[\s>]/g) || []).length).filter(n => n > 0);
    return { headCells, rows };
  };
  // n8n mode only: document mode nests a whole breakdown TABLE inside its Cross
  // Check cell, and a flat count of <td> between <tr> tags cannot tell an inner
  // row from an outer one. The Company Chop row -- the one that drifted -- is
  // drawn by the same code in both modes, so n8n mode still covers it.
  const counted = cellCounts(n8nTable);
  ok('every Verify Table row matches the header cell for cell',
    counted.rows.length > 5 && counted.rows.every(n => n === counted.headCells),
    counted);

  // Three documents answer the Cross Check column and it used to say so only in
  // words. The colour is a second carrier, never the only one.
  const cc = app.CROSS_CHECK_SOURCES;
  const shades = ['agreement', 'quotation', 'atq'].map(k => cc[k].className);
  const cssVars = { '--orange-dark': '#B35F00' };
  const textColorOf = className => {
    const literal = className.match(/text-\[(#[0-9A-F]{6})\]/);
    if (literal) return literal[1];
    const variable = className.match(/text-\[var\((--[a-z-]+)\)\]/);
    return variable ? cssVars[variable[1]] : null;
  };
  ok('each cross-check document has its own colour', new Set(shades).size === 3);
  ok('...and all three reach the page', shades.every(c =>
    n8nTable.includes(textColorOf(c))), shades);
  ok('...while keeping the name beside the colour',
    n8nTable.includes('Agreement') && n8nTable.includes('Quotation') && n8nTable.includes('ATQ (Excel)'));
  ok('a row naming no role still answers from the ATQ workbook',
    app.crossCheckSourceOf({}).key === 'atq');
  ok('...and one naming a role is labelled after it',
    app.crossCheckSourceOf({ sourceRole: 'quotation' }).label === 'Quotation' &&
    app.crossCheckSourceOf({ sourceRole: 'agreement' }).label === 'Agreement');
  // Green is already spoken for by the row-status tick; a green badge beside a
  // red status icon would report agreement and conflict on the same line.
  ok('no cross-check badge borrows the "agrees" green',
    !/#(15803D|3D8B5F)/.test(shades.join(' ')));
}

/* ---------- the viewer's Print button ----------
   `printableFor` is the pure half, so what WOULD be printed is checkable here;
   the iframe and print() themselves are browser-only. The two halves the
   harness can see are: every previewKind resolves to the right mode, and the
   header draws the button in both its states. */
{
  const header = (label, doc, entry, url) => renders(label,
    React.createElement(app.ViewerHeader,
      { doc, entry, url, onClose: noop, diffCount: 0, inline: false }));

  const pdfDoc = { fileName: 'Contract.pdf', previewKind: 'pdf', blob: { size: 1 }, ext: 'pdf' };
  const live = header('ViewerHeader with a retained PDF', pdfDoc, null, 'blob:x');
  ok('the header offers Print', live.includes('Print'));
  ok('...beside Download, not instead of it', live.includes('Download'));
  ok('...and it is live, not advice',
    /<button title="Print every page of Contract\.pdf"(?![^>]*disabled)/.test(live),
    live.slice(live.indexOf('Print') - 120, live.indexOf('Print') + 40));

  // Same three sentences Download uses, so the two buttons never disagree
  // about why they are off.
  const demoDoc = { fileName: 'Demo.pdf', previewKind: 'pdf', blob: null, demo: true, ext: 'pdf' };
  const off = header('ViewerHeader on demo data', demoDoc, null, '');
  ok('a document with no original cannot be printed', off.includes('Demo data — no original file'));
  ok('...and the button says so rather than failing on click',
    /disabled=""[^>]*title="Demo data/.test(off) || /title="Demo data[^"]*"[^>]*disabled=""/.test(off), off.slice(0, 600));

  const big = { fileName: 'Huge.pdf', previewKind: 'pdf', blob: null, ext: 'pdf' };
  ok('an unretained original gives the 25 MB reason',
    app.printableFor(big, null, '').reason.includes('25 MB'));
  // A PDF prints from the bytes, so it never waits on the viewer's object URL;
  // an image does, because its printed page IS an <img src>.
  ok('a PDF prints before the object URL exists',
    app.printableFor(pdfDoc, null, '').mode === 'pdf',
    app.printableFor(pdfDoc, null, ''));
  ok('an image with no object URL yet is "preparing", not "not retained"',
    app.printableFor({ fileName: 'a.png', previewKind: 'image', blob: { size: 1 } }, null, '').reason === 'Preparing…');

  // Mode per previewKind. The three fed by the parse tree print with no blob
  // at all -- the same split PreviewPane makes.
  ok('a PDF prints through the browser\'s own PDF printer',
    app.printableFor(pdfDoc, null, 'blob:x').mode === 'pdf');
  ok('an image prints as one page',
    app.printableFor({ fileName: 'a.png', previewKind: 'image', blob: { size: 1 } }, null, 'blob:x').mode === 'html');
  ok('text prints with no blob',
    app.printableFor({ fileName: 'a.txt', previewKind: 'text', textLines: ['one', 'two'] }, null, '').mode === 'html');
  ok('...and carries its lines',
    app.printableFor({ fileName: 'a.txt', previewKind: 'text', textLines: ['one', 'two'] }, null, '').html.includes('one\ntwo'));
  ok('an inlined .mht prints its own html',
    app.printableFor({ fileName: 'a.mht', previewKind: 'html', previewHtml: '<b>hi</b>' }, null, '').html === '<b>hi</b>');
  ok('a format with no preview refuses rather than printing a blank page',
    app.printableFor({ fileName: 'a.docx', previewKind: 'other', blob: { size: 1 } }, null, 'blob:x').mode === 'none');

  // The load-bearing one: a workbook's "all pages" is every worksheet, not the
  // tab the preview happens to be showing.
  const sheetEntry = { pages: [{ pages: [
    { html: '<table><tr><td>Cost</td></tr></table>', sheetName: 'Cost' },
    { html: '<table><tr><td>ATQ</td></tr></table>', sheetName: 'ATQ' },
    { html: '<table><tr><td>Notes</td></tr></table>', sheetName: 'Notes' },
  ] }] };
  const sheetDoc = { fileName: 'ATQ.xlsx', previewKind: 'sheet', pagesIndex: 0, blob: { size: 1 } };
  const sheetOut = app.printableFor(sheetDoc, sheetEntry, 'blob:x');
  ok('a workbook prints as html', sheetOut.mode === 'html');
  ok('...every worksheet, not the selected one',
    ['Cost', 'ATQ', 'Notes'].every(n => sheetOut.html.includes('>' + n + '<')), sheetOut.html.slice(0, 300));
  // Counted on the inline style only -- PRINT_PAGE_CSS carries its own
  // page-break rules for the image/raster path and would inflate a bare count.
  const breaks = (sheetOut.html.match(/style="page-break-after:[a-z]+"/g) || []);
  ok('...each on its own sheet of paper',
    breaks.filter(b => b.includes('always')).length === 2, breaks);
  ok('...and the last one does not force a trailing blank page',
    breaks.filter(b => b.includes('auto')).length === 1, breaks);
  ok('a sheet name is escaped, not injected',
    app.printSheetHtml([{ html: '<table></table>', sheetName: '<script>x</script>' }]).includes('&lt;script&gt;'));

  // printableFor takes no sheetIndex on purpose -- printing the visible tab
  // alone would be indistinguishable from a one-sheet workbook.
  ok('printableFor is not given the selected tab',
    /function printableFor\(doc, entry, url\)/.test(appSource));
  // The first version of this feature failed SILENTLY in the real
  // Model-Driven App: a hidden iframe pointed at a blob: URL never fired its
  // load event, so print() was never reached and nothing was reported. Three
  // things guard that now, and each one alone would have left it silent.
  ok('a print that never loads gives up rather than waiting forever',
    /PRINT_LOAD_TIMEOUT_MS/.test(appSource) &&
    appSource.includes('The print document did not load.'));
  ok('...the reason reaches the header, not just the console',
    /onFail\((?:\(e && e\.message\) \|\| )?"Print failed"\)/.test(appSource) &&
    /className="shrink-0 max-w-\[220px\] truncate text-\[11px\] font-semibold text-\[#B78312\]">\{printErr\}/.test(appSource));
  ok('...and a host frame that forbids dialogs falls back to a new tab',
    /function sandboxBlocksModals\(\)/.test(appSource) &&
    /function printInNewTab\(/.test(appSource));
  // Rendering a long scan takes seconds; a button with no sign of life is the
  // same bug as a button that does nothing.
  ok('printing reports progress while it renders',
    appSource.includes('"Preparing page " + i + " of " + pdf.numPages') &&
    /disabled=\{!!printBusy\}/.test(appSource));
  // The PDF plugin and the blob: navigation are what failed. Neither is on the
  // path any more.
  ok('no print path navigates a frame to a blob: URL',
    !/^\s*frame\.src\s*=/m.test(appSource),
    (appSource.match(/^\s*frame\.src[^;]*/gm) || []));
  // The frame's own window, never this one: window.print() inside a
  // Model-Driven App frame prints the app chrome wrapped round the document.
  ok('printing goes through the hidden frame\'s own window',
    /frame\.contentWindow/.test(appSource) && /w\.print\(\);/.test(appSource));
}

/* ---------- LIS & Remark: "Process Another Item" ---------- */

// One procurement email carries the documents for EVERY item its ATQ covers,
// so finishing one item does not finish the email. The card is the dev side's
// way back: press the button, land on the Document Workbench with the next
// unsaved item selected, re-pick its documents, press Start again under a NEW
// Record_ID.
//
// The card is the BUTTON ALONE. Its own draft picker was removed: the item is
// chosen on the Document Workbench, whose selector the button highlights on
// arrival, so there is one control for one decision instead of two on two
// pages. The `done` rule itself is pinned in recordid.test.js
// (itemProcessOptions); what is pinned here is that the card draws no picker
// and that the Workbench selector draws the greying and the cue.
{
  const item = n => ({ fields: [{ label: 'Item No.', value: String(n) }] });
  const lisProps = extra => Object.assign({
    fields: {}, lisRowValues: {},
    attachments: { ATQ: { parsed: true, records: [item(2), item(3)] } },
    itemIndex: 0, selectItem: () => {},
    itemRecordIds: [{ recordId: 'ATQ-1-2' }, { recordId: 'ATQ-1-3' }],
    savedRecordIds: { 'ATQ-1-2': true },
    processAnotherItem: () => {},
    goUpload: () => {}, goSave: () => {}, saving: false, savedRecordId: '',
    setField: () => {},
  }, extra || {});

  const multi = renders('LisRemarkPage on a two-item ATQ',
    React.createElement(app.LisRemarkPage, lisProps()));
  ok('the card names what it is for', multi.includes('Another item on this email'));
  ok('...and says how many items this email covers', multi.includes('covers 2 items'));
  ok('...and carries the button', multi.includes('Process Another Item'));
  // The card draws NO item picker of its own -- not a disabled one, not a
  // read-only one. "Item 3" is the item the button targets, and naming it here
  // would be the same second control under another name; the Workbench's
  // selector is where it is chosen and shown.
  ok('the card carries no item picker of its own', !multi.includes('Item 3'));
  // The button still opens on the next item there is work to do on, not on the
  // item already on screen -- a button that reloads the current item reads as
  // broken rather than as "nothing left to do". Derived, not state, so a just
  // saved item cannot leave a stale useState initialiser behind.
  ok('...and the button targets the next unsaved item',
    appSource.includes("itemOptions.find(o => !o.done && o.index !== itemIndex)") &&
    appSource.includes('processAnotherItem(nextOption.index)'));

  // The plain view-switcher in the TopBar is the OTHER side's control, and it
  // is still not drawn beside this card.
  ok('no item picker in the TopBar beside the card',
    multi.indexOf('Another item on this email') >= 0 && !multi.includes('Item 2'));

  // A single-item ATQ has no other item to go and process, and a card saying
  // "covers 1 items" would be worse than silence.
  const single = renders('LisRemarkPage on a single-item ATQ',
    React.createElement(app.LisRemarkPage, lisProps({
      attachments: { ATQ: { parsed: true, records: [item(2)] } },
      itemRecordIds: [], savedRecordIds: {},
    })));
  ok('a single-item upload draws no "another item" card',
    !single.includes('Another item on this email'));

  // ---- the other half: the Document Workbench's own Item selector ----
  //
  // A saved item stays in the LIST there and says so -- filtering it out would
  // read as "this ATQ never covered an item 2". The option ROWS only exist once
  // the dropdown is open, which renderToStaticMarkup never does, so this half
  // is pinned on the source: `disabled` is the AnimatedSelect flag that greys a
  // row without removing it, and `done` is the only thing feeding it.
  ok('a saved item is greyed rather than dropped from the Workbench selector',
    appSource.includes('label: option.done ? option.label + " \u2014 saved" : option.label, disabled: option.done'));

  // A two-item ATQ, because the cue is withheld on a single-item upload -- the
  // shipped demo carries no line-item records at all, so the default
  // uploadProps could never show it.
  const twoItemAttachments = Object.assign({}, demo, {
    ATQ: Object.assign({}, demo.ATQ, { parsed: true, records: [item(2), item(3)] }),
  });
  const hintedProps = Object.assign({}, uploadProps,
    { attachments: twoItemAttachments, itemPickHint: true });
  const hinted = renders('UploadPage after Process Another Item',
    React.createElement(app.UploadPage, hintedProps));
  // The cue is a SENTENCE as well as a ring: the ring says something changed
  // and nothing else says what, and this is now the only page where the item
  // is chosen.
  ok('the arrival cue names what to do', hinted.includes('Pick the item you want to process next'));
  ok('...and rings the selector it is about', hinted.includes('ring-[rgba(255,153,0,0.35)]'));
  // The rest of the page is dimmed behind it -- the same whole-viewport
  // backdrop the Back-to-Back gate uses, so the sidebar and TopBar go dark too
  // rather than a rectangle inside one Card.
  ok('...and dims the rest of the page behind it',
    hinted.includes('fixed inset-0 z-40 bg-black/45'));
  // Raised through that backdrop on a painted panel of its own: at z-50 alone
  // the dim would show between the pill's own words.
  ok('...with the selector raised through the dim on its own panel',
    hinted.includes('relative z-50 -mx-2 px-3 py-2.5 rounded-xl bg-[#F4F0E8]'));
  ok('...and none of it is drawn until the button has been pressed',
    !uploadHtml.includes('Pick the item you want to process next') &&
    !uploadHtml.includes('ring-[rgba(255,153,0,0.35)]') &&
    !uploadHtml.includes('fixed inset-0 z-40 bg-black/45'));
  // Withheld on a single-item upload too: there is nothing there to pick.
  const hintedSingle = renders('UploadPage hinted on a one-item upload',
    React.createElement(app.UploadPage, Object.assign({}, uploadProps, { itemPickHint: true })));
  ok('...and withheld when the upload covers one item',
    !hintedSingle.includes('Pick the item you want to process next'));
  // Withheld where it would point at a control that cannot answer it: the
  // selector is locked once Start has been pressed for this item.
  const hintedLocked = renders('UploadPage hinted but locked',
    React.createElement(app.UploadPage, Object.assign({}, hintedProps,
      { itemSelectionLocked: true })));
  ok('...and withheld while the selector is locked',
    !hintedLocked.includes('Pick the item you want to process next') &&
    !hintedLocked.includes('fixed inset-0 z-40 bg-black/45'));
}

/* ---------- report ---------- */

console.log(passed + ' passed, ' + failures.length + ' failed');
if (failures.length) {
  failures.forEach(f => console.log('  FAIL  ' + f));
  process.exit(1);
}
