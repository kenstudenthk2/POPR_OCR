// Which documents the "Send to n8n" button on Upload & Parse actually posts.
//
//   node _test/app-harness/n8n-send.test.js
//
// The button reads the ROLE SLOTS, not the document viewer and not the active
// tab, so the thing worth pinning down is that roleDocumentsForSend resolves the
// same documents roleCensus put in those slots -- down to the file bytes, which
// the slots themselves never carry (a slot holds a *source*: typeKey + docIndex
// and metadata, never a blob).
//
// The POST itself is not tested here and cannot be: there is no fetch, no
// FormData and no n8n in this harness. What is testable is everything that
// decides WHAT goes into that FormData, which is where a silent mistake would
// live -- a document dropped from the upload looks exactly like a document that
// was never assigned a role.
//
// The blobs below are sentinel objects rather than real Blobs on purpose:
// roleDocumentsForSend only carries them through to FormData.append, so identity
// is the whole of what these assertions can honestly check.

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

function bytes(tag) { return { sentinel: tag }; }

// One document as the engine leaves it on entry.docs. `pagesIndex` points into
// entry.pages, which is empty here -- docHeadingLines returns [] for that, so
// every role below is decided by the filename, which is what these fixtures are
// about.
function doc(index, fileName, blob) {
  return { index, fileName, inline: false, blob, pagesIndex: index,
    fields: [], records: [], signing: null, ocrPending: false, resumable: false };
}

// One email dropped into the Contract tab, carrying all four role documents --
// the normal case now, and the one where a typeKey-keyed lookup would find only
// the tab it was literally dropped into.
function emailAttachments(docs) {
  return Object.assign({}, app.EMPTY_ATTACHMENTS, {
    Contract: { parsed: true, file: 'case.msg', fileObj: null, text: '', rawFields: [],
      records: null, isAtqRecord: false, docs, pages: [], signing: null,
      phase: 'light', pendingDocs: [] },
  });
}

/* ---------- all three slots filled, three distinct documents ---------- */

const agreementBytes = bytes('agreement');
const atqBytes = bytes('atq');
const quotationBytes = bytes('quotation');

const fullDocs = [
  doc(0, 'Maintenance Service Agreement.pdf', agreementBytes),
  doc(1, 'ATQ 2026-0481.pdf', atqBytes),
  doc(2, 'Q2026050009R quotation.pdf', quotationBytes),
];
const full = emailAttachments(fullDocs);
const fullCensus = app.roleCensus(full);
const fullSend = app.roleDocumentsForSend(full, fullCensus);

eq('every filled role slot contributes exactly one file', fullSend.files.length, 3);
eq('nothing is skipped when every slot has bytes', fullSend.skipped.length, 0);

// The field names n8n will see. They are the role keys, not the attachment-tab
// names -- all three of these documents were dropped into one tab, so a tab-named
// field would say "Contract" three times.
eq('the FormData field names are the role keys',
  fullSend.files.map(f => f.roleKey).join(','), 'agreement,atq,quotation');

const byRole = {};
fullSend.files.forEach(f => { byRole[f.roleKey] = f; });
eq('the Agreement slot sends the agreement bytes', byRole.agreement.blob, agreementBytes);
eq('the ATQ slot sends the ATQ bytes', byRole.atq.blob, atqBytes);
eq('the Quotation slot sends the quotation bytes', byRole.quotation.blob, quotationBytes);
eq('the filename travels with the file, not just the role',
  byRole.quotation.fileName, 'Q2026050009R quotation.pdf');
eq('the source is carried so the flow can be traced back to a document',
  byRole.atq.typeKey + '#' + byRole.atq.docIndex, 'Contract#1');

// The one that would go unnoticed: send must agree with the bar the reviewer
// read before pressing it. If these two ever name different documents, the
// reviewer approved one thing and n8n received another.
app.DOC_ROLES.forEach(role => {
  const slot = fullCensus.assigned[role.key];
  const sent = byRole[role.key];
  eq('the ' + role.label + ' slot and the sent file are the same document',
    sent && sent.fileName, slot && app.sourceBaseName(slot.doc));
});

/* ---------- an empty slot is not a failure ---------- */

const noQuote = emailAttachments(fullDocs.slice(0, 2));
const noQuoteSend = app.roleDocumentsForSend(noQuote, app.roleCensus(noQuote));
eq('an upload with no quotation sends two files', noQuoteSend.files.length, 2);
ok('an empty slot is absent, not skipped -- there was never a file to skip',
  noQuoteSend.skipped.length === 0 && !noQuoteSend.files.some(f => f.roleKey === 'quotation'), noQuoteSend);

/* ---------- a document with no bytes is reported, never dropped ---------- */

const blobless = emailAttachments([
  doc(0, 'Maintenance Service Agreement.pdf', null),
  doc(1, 'ATQ 2026-0481.pdf', atqBytes),
]);
const bloblessSend = app.roleDocumentsForSend(blobless, app.roleCensus(blobless));
eq('only the document that has bytes is sent', bloblessSend.files.length, 1);
eq('the one that has none is named', bloblessSend.skipped.length, 1);
eq('and it is named by its role, which is what the slot bar calls it',
  bloblessSend.skipped[0].label, 'Agreement');

/* ---------- extra Quotation documents added by hand (RoleAssignmentEditor's
   "Add quotation" button) -- send-only, so they ride the same "quotation"
   field name as the primary pick rather than getting a role of their own ---- */

const secondQuotationBytes = bytes('quotation-second');
const thirdQuotationBytes = bytes('quotation-third');

const multiQuoteDocs = fullDocs.concat([
  doc(3, 'Second vendor quotation.pdf', secondQuotationBytes),
  doc(4, 'Third vendor quotation.pdf', thirdQuotationBytes),
]);
const multiQuote = emailAttachments(multiQuoteDocs);
const multiQuoteOverrides = {
  quotationExtra: [
    app.docKeyOf({ typeKey: 'Contract', docIndex: 3 }),
    app.docKeyOf({ typeKey: 'Contract', docIndex: 4 }),
  ],
};
const multiQuoteCensus = app.roleCensus(multiQuote, multiQuoteOverrides);
const multiQuoteSend = app.roleDocumentsForSend(multiQuote, multiQuoteCensus);
const quoteFiles = multiQuoteSend.files.filter(f => f.roleKey === 'quotation');

eq('extraQuotationDocs resolves both picks off the census doc pool',
  app.extraQuotationDocs(multiQuoteCensus).length, 2);
eq('the primary quotation plus both extras all get sent', quoteFiles.length, 3);
eq('non-quotation roles are unaffected by the extras',
  multiQuoteSend.files.filter(f => f.roleKey !== 'quotation').length, 2);
ok('the extras carry the documents actually picked, primary first',
  quoteFiles[0].blob === quotationBytes &&
  quoteFiles[1].blob === secondQuotationBytes &&
  quoteFiles[2].blob === thirdQuotationBytes,
  quoteFiles.map(f => f.fileName));

// An extra quotation still awaiting bytes is reported like any other slot,
// never silently dropped -- see the blobless block above for the primary case.
const extraBlobless = emailAttachments(fullDocs.concat([
  doc(3, 'Second vendor quotation.pdf', null),
]));
const extraBloblessCensus = app.roleCensus(extraBlobless,
  { quotationExtra: [app.docKeyOf({ typeKey: 'Contract', docIndex: 3 })] });
const extraBloblessSend = app.roleDocumentsForSend(extraBlobless, extraBloblessCensus);
eq('an extra quotation with no bytes yet is skipped, not dropped', extraBloblessSend.skipped.length, 1);
eq('...named as an extra so the reviewer can tell which pick is missing',
  extraBloblessSend.skipped[0].label, 'Quotation (extra 1)');
eq('and by its filename, which is what the reviewer sees on it',
  bloblessSend.skipped[0].fileName, 'Maintenance Service Agreement.pdf');

/* ---------- the tab's own dropped file (docIndex -1) ---------- */

// A single PDF dropped straight onto a tab has no entry.docs at all: roleCensus
// stands in one item at index -1, and the bytes are on entry.fileObj rather than
// on any doc. docAt/selfDocFor is the join, and without it this case sends
// nothing while looking perfectly healthy.
const selfBytes = bytes('self');
const selfDropped = Object.assign({}, app.EMPTY_ATTACHMENTS, {
  Contract: { parsed: true, file: 'Maintenance Service Agreement.pdf',
    fileObj: { name: 'Maintenance Service Agreement.pdf', type: 'application/pdf', size: 12, sentinel: 'self' },
    text: '', rawFields: [], records: null, isAtqRecord: false,
    docs: [], pages: [], signing: null, phase: 'light', pendingDocs: [] },
});
const selfSend = app.roleDocumentsForSend(selfDropped, app.roleCensus(selfDropped));
eq('a file dropped on its own still reaches the FormData', selfSend.files.length, 1);
eq('under the role its own name claims', selfSend.files[0].roleKey, 'agreement');
eq('carrying the file the user actually picked',
  selfSend.files[0].blob, selfDropped.Contract.fileObj);
eq('at the sentinel index roleCensus uses for a tab\'s own file',
  selfSend.files[0].docIndex, -1);

/* ---------- nothing assigned ---------- */

const emptySend = app.roleDocumentsForSend(app.EMPTY_ATTACHMENTS, app.roleCensus(app.EMPTY_ATTACHMENTS));
ok('an untouched page has nothing to send and says so by being empty',
  emptySend.files.length === 0 && emptySend.skipped.length === 0, emptySend);

/* ---------- the same document in two slots is posted under BOTH ---------- */

// A signed quotation that is also the agreement is one file and two roles, and
// the reviewer says so by handing it to both slots by hand. The field name IS
// how the flow reads the role, so it is posted twice -- once per role -- rather
// than once with a note beside it that every downstream node would have to
// re-read.
const shared = emailAttachments([doc(0, 'Signed quotation.pdf', quotationBytes)]);
const sharedSource = { typeKey: 'Contract', docIndex: 0, fileName: 'Signed quotation.pdf' };
const sharedSend = app.roleDocumentsForSend(shared, {
  assigned: { agreement: { doc: sharedSource }, quotation: { doc: sharedSource }, atq: null, po: null },
});
eq('one document filling two slots is posted under each of them',
  sharedSend.files.length, 2);
eq('the first part carries the first role', sharedSend.files[0].roleKey, 'agreement');
eq('the second part carries the second', sharedSend.files[1].roleKey, 'quotation');
eq('and both are the same bytes', sharedSend.files[0].blob, sharedSend.files[1].blob);
eq('each part still names the whole set of roles it stands for',
  sharedSend.files[0].roles.join(','), 'agreement,quotation');
eq('...on the second part too', sharedSend.files[1].roles.join(','), 'agreement,quotation');

// The census side of the same case: `d.role` is single-valued, so before this an
// override naming one file for two roles filled whichever slot DOC_ROLES reached
// first and left the other empty -- a reviewer looking at two filled slots while
// three documents went out.
const sharedKey = app.docKeyOf(sharedSource);
const sharedCensus = app.roleCensus(shared, { agreement: sharedKey, quotation: sharedKey });
ok('an override fills the Agreement slot', !!(sharedCensus.assigned.agreement || {}).doc,
  sharedCensus.assigned.agreement);
ok('...and the Quotation slot with the same document',
  (sharedCensus.assigned.quotation || {}).doc &&
  sharedCensus.assigned.quotation.doc.key === sharedKey, sharedCensus.assigned.quotation);
eq('so the send has two parts for one file',
  app.roleDocumentsForSend(shared, sharedCensus).files.length, 2);

/* ---------- the webhook constant ---------- */

// Pinned because the URL is edited by hand and a typo here fails at the
// network, far from the edit.
eq('the webhook URL is the one the flow listens on', app.N8N_WEBHOOK_URL,
  'https://d1u4t2v5sfu1y7.cloudfront.net/webhook/59d74e8c-0f6e-4816-91f5-dee2a01cb387');

/* ---------- scalar metadata beside the multipart files ---------- */

const metadataAttachments = Object.assign({}, app.EMPTY_ATTACHMENTS, {
  Contract: { parsed: true, text: 'Subject: ABC Company - (UID-26-07-0126-2-3)\nBody', docs: [] },
  // A PDF can have a different row ordering/content; n8n must still use the
  // selected row in the Excel Cost worksheet.
  ATQ: { parsed: true, records: [
    { fields: [{ label: 'Item No.', value: '1' }] },
    { fields: [{ label: 'Item No.', value: '2' }] },
  ] },
  Excel: { parsed: true, records: [
    { fields: [{ label: 'Item No.', value: '2' }, { label: 'ATQ Ref. No.', value: 'ATQ-2' }] },
    { fields: [{ label: 'Item No.', value: '3' }, { label: 'ATQ Ref. No.', value: 'ATQ-3' }] },
  ] },
});
const metadataFields = {
  uid: { value: 'UID-form-fallback' },
  atqRefNo: { value: 'ATQ-202604-00177' },
  customerName: { value: 'ABC Company Ltd' },
};
const metadata = app.n8nMetadataForSend(metadataFields, metadataAttachments, 1);
eq('UID comes from the imported email Subject header', metadata.uid, 'UID-26-07-0126-2-3');
eq('ATQ reference comes from the extracted form value', metadata.atqRefNo, 'ATQ-202604-00177');
eq('customer name comes from the extracted form value', metadata.customerName, 'ABC Company Ltd');
eq('item number comes from the selected Cost-sheet record', metadata.itemNo, '3');

const roleWorkbookAttachments = Object.assign({}, app.EMPTY_ATTACHMENTS, {
  'Vendor Quotation': {
    parsed: true,
    docs: [{
      index: 8,
      fileName: 'ATQ-202604-00249-V01.xlsx',
      records: [{ fields: [{ label: 'Item No.', value: 'ATQ-COST-7' }] }],
    }],
  },
  Excel: { parsed: false, records: [] },
});
const roleWorkbookCensus = {
  assigned: {
    atq: { doc: { typeKey: 'Vendor Quotation', docIndex: 8, fileName: 'ATQ-202604-00249-V01.xlsx' } },
  },
};
eq('item number comes from the assigned ATQ workbook Cost sheet',
  app.n8nMetadataForSend(metadataFields, roleWorkbookAttachments, 0, roleWorkbookCensus).itemNo,
  'ATQ-COST-7');

const noSubject = Object.assign({}, metadataAttachments, { Contract: { parsed: true, text: 'Body only', docs: [] } });
eq('UID falls back to the form for non-email uploads',
  app.n8nMetadataForSend(metadataFields, noSubject, 0).uid, 'UID-form-fallback');
eq('missing Excel records produce a blank item number',
  app.n8nMetadataForSend(metadataFields, app.EMPTY_ATTACHMENTS, 0).itemNo, '');

/* ---------- one reader for "where does the UID come from" ---------- */

// This used to be a private loop inside n8nMetadataForSend. The Extracted
// Fields table needed the same answer, and two copies of it drifting apart is
// exactly how the preview ends up showing a different UID from the one that was
// sent -- so both now go through uidFromEmail, and this pins that they do.
eq('n8nMetadataForSend and the preview agree by construction',
  metadata.uid, app.uidFromEmail(metadataAttachments, metadataFields));

// The header LINE, not the whole text. A forwarded thread quotes an older
// request further down; matching the first hit anywhere in the body only lands
// on the right one because the header happens to be printed first, which is
// luck rather than a rule.
{
  const forwarded = Object.assign({}, app.EMPTY_ATTACHMENTS, {
    Contract: { parsed: true, docs: [], text: [
      'Subject: BTB PR REQUEST (Item 4) - ABC Company Ltd - (UID-20-03-0003-4)Type-Networking',
      '',
      '> -----Original Message-----',
      '> Subject: PR REQUEST - ABC Company Ltd - (UID-20-99-9999-1)Type-Logger',
    ].join('\n') },
  });
  eq('the quoted thread below the header does not supply the UID',
    app.uidFromEmail(forwarded, metadataFields), 'UID-20-03-0003-4');
}

// Second tier: the dropped file's own NAME. A .msg saved to disk is named after
// its subject, so a mail whose bytes could not be opened -- or one saved and
// re-dropped by hand -- still has its subject printed on the outside.
{
  const named = Object.assign({}, app.EMPTY_ATTACHMENTS, {
    Contract: { parsed: true, docs: [], text: 'Body only, no header',
      file: '2_NON-BTB PR REQUEST (Item 10) - ABC Company Ltd - (UID-20-02-0002-10)Type-Logger - HP - Chan Alex TM(10-Nice Systems BV).msg' },
  });
  eq('a file name carrying a UID is read when the text has no header',
    app.uidFromEmail(named, {}), 'UID-20-02-0002-10');
  eq('...and the whole subject is available from it, not just the UID',
    app.emailSubjectOf(named).itemNo, '10');
}

// The two tiers are deliberately not symmetrical: a real Subject header counts
// even with no UID in it, but a file name counts only when it carries one --
// otherwise every loose PDF dropped on a tab presents itself as the subject.
{
  const loose = Object.assign({}, app.EMPTY_ATTACHMENTS, {
    Contract: { parsed: true, docs: [], text: 'Body only', file: 'signed contract.pdf' },
  });
  eq('a loose file name is not mistaken for a subject line',
    app.emailSubjectOf(loose), null);
  eq('...so the UID falls through to the form',
    app.uidFromEmail(loose, metadataFields), 'UID-form-fallback');
}

eq('nothing uploaded and nothing typed is "", not undefined',
  app.uidFromEmail(app.EMPTY_ATTACHMENTS, {}), '');

// App memoises the subject parse on `attachments` and hands it in, because the
// parse reads every attachment's whole plain text and cannot depend on the
// form. The third argument is optional and omitting it must do exactly what it
// did before it existed.
eq('a handed-in subject is used instead of re-parsing',
  app.uidFromEmail(app.EMPTY_ATTACHMENTS, metadataFields, { uid: 'UID-20-05-0005-1' }),
  'UID-20-05-0005-1');
eq('...and passing null for it means "no email", not "re-read it"',
  app.uidFromEmail(metadataAttachments, metadataFields, null), 'UID-form-fallback');
eq('omitting it reads the attachments, exactly as before',
  app.uidFromEmail(metadataAttachments, metadataFields), metadata.uid);

/* ---------- report ---------- */

console.log(passed + ' passed, ' + failures.length + ' failed');
if (failures.length) {
  failures.forEach(f => console.log('  FAIL  ' + f));
  process.exit(1);
}
