// What the Document Viewer can SHOW — the email formats and the text ones.
//
//   node _test/app-harness/email-preview.test.js
//
// Three gaps this pins, each of which looked on screen exactly like "this
// format cannot be read":
//
//  1. .msg/.eml had no visual original at all. stripHtmlToText is right for the
//     text pass -- a price table reads as prose either way and the cross-check
//     only wants the words -- and wrong for a reviewer, because an email's
//     tables, its bold and the company chop somebody pasted into the body ARE
//     the document. `buildEmailPreviewHtml` keeps a second, render-only copy.
//  2. An email inside an email was one skipped attachment. parseByExt refused
//     msg/eml at any depth but 0, so a forwarded PR request's own agreement and
//     ATQ were never reached.
//  3. Plain text did not work at ALL, at either end. `previewKindFor` has
//     answered 'text' for a .txt since the beginning and `parseByExt` had no
//     branch for one, so a .txt ATTACHMENT came back `status: 'skipped'` and a
//     .txt dropped on its own threw `Unsupported file type: .txt`. Two halves
//     were needed: `processText` behind the `textAttachments` opt, and
//     `textLinesFor` in the App, because PreviewPane's text branch reads
//     `textLines`, which only selfDocFor ever set.
//
// The engine half runs under plain Node because buildEmailPreviewHtml is pure
// over {contentId, mimeType, getContent} descriptors: no MsgReader, no
// postal-mime, no canvas. It is deliberately NOT given the descriptor list
// processEmailAttachments gets -- see the comment on the function -- and the
// "two lists, not one" rule is asserted below as a source check, because
// isInlineFurniture reading a contentId is the failure it prevents.

const path = require('path');
const fs = require('fs');
const vm = require('vm');
const { load } = require('./app.js');
const { renderToStaticMarkup } = require('react-dom/server');
const React = require('react');

const ENGINE_PATH = path.join(__dirname, '..', '..', 'Docparse', 'docparse-engine.js');
const APP_PATH = path.join(__dirname, '..', '..', 'PR Assistant App.html');
const engineSrc = fs.readFileSync(ENGINE_PATH, 'utf8');
const appSrc = fs.readFileSync(APP_PATH, 'utf8');
vm.runInThisContext(engineSrc, { filename: 'docparse-engine.js' });
const { buildEmailPreviewHtml, previewKindFor, parseFile, TEXT_EXTS } = globalThis.DocparseEngine;

const app = load({ react: true });

let passed = 0;
const failures = [];

function ok(label, cond, detail) {
  if (cond) { passed++; return; }
  failures.push(label + (detail === undefined ? '' : '\n      got: ' + JSON.stringify(detail).slice(0, 500)));
}
function eq(label, actual, expected) {
  ok(label, actual === expected, { actual, expected });
}
function has(label, haystack, needle) {
  ok(label, String(haystack).includes(needle), String(haystack).slice(0, 500));
}
function hasNot(label, haystack, needle) {
  ok(label, !String(haystack).includes(needle), String(haystack).slice(0, 500));
}

// A one-pixel GIF, so an inlined data: URL can be compared against a known
// string rather than merely "starts with data:".
const GIF_BYTES = Uint8Array.from(
  atob('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA='),
  c => c.charCodeAt(0));
const GIF_B64 = 'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA=';

// Records whether the bytes were actually asked for, which is how "only the
// parts the page paints with are decoded" can be checked at all.
function part(contentId, mimeType, bytes) {
  const p = {
    contentId,
    mimeType,
    fetched: 0,
    getContent: async () => { p.fetched++; return bytes === undefined ? GIF_BYTES : bytes; },
  };
  return p;
}

(async function run() {

  /* ---------- 1. the engine's email preview ---------- */

  eq('no HTML body means no preview, not an empty frame',
    await buildEmailPreviewHtml('', [part('<logo>', 'image/gif')]), '');
  eq('whitespace-only HTML is the same as none',
    await buildEmailPreviewHtml('   \n  ', []), '');
  eq('a null body is tolerated the way an absent one is',
    await buildEmailPreviewHtml(null, null), '');

  {
    const logo = part('<image001.gif@01DA>', 'image/gif');
    const html = await buildEmailPreviewHtml(
      '<p><b>Please find attached</b></p><img src="cid:image001.gif@01DA">', [logo]);
    has('the body keeps its markup -- which is the whole point of the preview', html, '<b>Please find attached</b>');
    has('an inline image becomes a data: URL', html, 'src="data:image/gif;base64,' + GIF_B64 + '"');
    hasNot('...and no cid: reference survives for the sandbox to fail on', html, 'cid:');
    eq('the referenced part was decoded exactly once', logo.fetched, 1);
  }

  {
    // The angle brackets are how a MIME Content-ID header carries the id, and
    // the src never writes them. Matching literally leaves every Outlook logo
    // unresolved -- which does not fail loudly, it just shows nothing.
    const html = await buildEmailPreviewHtml(
      '<img src="cid:IMAGE001.GIF@01DA">', [part('<image001.gif@01da>', 'image/gif')]);
    has('a cid: match ignores the <> the header carries and the case it was written in',
      html, 'data:image/gif;base64,');
  }

  {
    const used = part('<used>', 'image/gif');
    const spare = part('<spare>', 'image/gif');
    const html = await buildEmailPreviewHtml('<img src="cid:used">', [used, spare]);
    has('the referenced part is inlined', html, 'data:image/gif;base64,');
    eq('an attachment the body never references is not decoded at all', spare.fetched, 0);
  }

  {
    // A cid: the email does not carry. Blanked rather than left alone: under
    // sandbox="" the fetch fails anyway, and a broken-image glyph says less
    // than nothing about an email that is otherwise complete.
    const html = await buildEmailPreviewHtml('<img src="cid:missing"><a href="cid:missing">x</a>', []);
    has('an unresolved cid: in a src is blanked', html, 'src=""');
    has('...but one in an href is left alone -- a link is inert under sandbox=""',
      html, 'href="cid:missing"');
  }

  {
    // Same rule buildMhtPreviewHtml follows: only what the page paints with.
    const doc = part('<contract>', 'application/pdf');
    const html = await buildEmailPreviewHtml('<img src="cid:contract">', [doc]);
    has('a cid: pointing at a non-image part is blanked, not inlined', html, 'src=""');
    eq('...and its bytes are never decoded -- the budget is for pixels', doc.fetched, 0);
  }

  {
    const p = part('<huge>', 'image/gif', new Uint8Array(3 * 1024 * 1024 + 1));
    const html = await buildEmailPreviewHtml('<img src="cid:huge">', [p]);
    has('an image over the inlining ceiling is blanked rather than held as 4 MB of base64',
      html, 'src=""');
  }

  {
    const p = part('<broken>', 'image/gif', undefined);
    p.getContent = async () => { throw new Error('attachment unreadable'); };
    const html = await buildEmailPreviewHtml('<p>body</p><img src="cid:broken">', [p]);
    has('one unreadable logo is not a failed email -- the body still renders', html, '<p>body</p>');
    has('...and its own src is blanked', html, 'src=""');
  }

  {
    const html = await buildEmailPreviewHtml(
      '<meta charset="big5"><script>steal()</script><div onclick="steal()">hi</div>'
      + '<img src="https://tracker.example/pixel.gif">'
      + '<iframe src="https://evil.example"></iframe>', []);
    hasNot('a script in the body does not reach the frame', html, 'steal()');
    hasNot('...nor an inline handler', html, 'onclick');
    hasNot('...nor an iframe', html, '<iframe');
    has('a remote image is blanked -- the tracking pixels Outlook blocks too', html, 'src=""');
    hasNot('...and its host is gone with it', html, 'tracker.example');
    has('the declared charset is retargeted: srcdoc is already-decoded text', html, 'charset=utf-8');
    hasNot('...so the original declaration cannot cause a second, wrong decode', html, 'big5');
  }

  /* ---------- 2. what a two-argument parseFile still returns ---------- */
  //
  // Docparse/index.html calls parseFile with two arguments and its output must
  // not move. Both of this change's engine halves are opts, so the only thing
  // that can betray them is previewKindFor, which takes an ext and no opts.

  eq('previewKindFor still calls an .eml "other" -- the App upgrades it, the engine does not',
    previewKindFor('eml'), 'other');
  eq('...and a .msg the same', previewKindFor('msg'), 'other');
  eq('an .mht is unchanged too', previewKindFor('mht'), 'html');
  eq('and .xlt is still a sheet', previewKindFor('xlt'), 'sheet');

  ok('the nested-email ceiling is opt-gated, so index.html keeps seeing one skipped attachment',
    /const emailDepthOk = depth === 0 \|\| \(depth <= 1 && !!\(opts && opts\.nestedEmails\)\);/.test(engineSrc));
  ok('processMsg builds a preview only when asked',
    /opts && opts\.emailPreviewHtml\)\s*\?\s*await buildEmailPreviewHtml\(msg\.bodyHtml/.test(engineSrc));
  ok('processEml builds a preview only when asked',
    /opts && opts\.emailPreviewHtml\)\s*\?\s*await buildEmailPreviewHtml\(email\.html/.test(engineSrc));
  ok('a nested email is rewritten into the document page vocabulary, the way a nested .mht is',
    (engineSrc.match(/if \(depth > 0\) emailPagesToDocPages\(result\);/g) || []).length === 3);

  // The two-lists rule. isInlineFurniture returns true for ANY part carrying a
  // contentId, so handing the preview's descriptors to processEmailAttachments
  // would re-classify every real attachment of every .msg as layout furniture.
  ok('no contentId is put on the descriptors the parse pass reads',
    !/getContent: async \(\) => reader\.getAttachment\(attMeta\)\.content,\s*\n\s*contentId/.test(engineSrc));
  ok('a container that rendered itself outranks previewKindFor',
    /if \(doc\.previewHtml\) doc\.previewKind = 'html';/.test(engineSrc));

  /* ---------- 2b. plain text: the format previewKindFor already claimed ---------- */
  //
  // Real behaviour, not a source check: parseFile on a .txt needs no library at
  // all, so both sides of the opt can be run right here.

  {
    const txt = new File([Buffer.from('Quotation No.: DQ-1\n\nQty 2\n', 'utf8')], 'note.txt',
      { type: 'text/plain' });
    let threw = '';
    try { await parseFile(txt, () => {}); } catch (e) { threw = e.message; }
    eq('a two-argument parseFile still refuses a .txt, exactly as it always did',
      threw, 'Unsupported file type: .txt');

    const r = await parseFile(txt, () => {}, { textAttachments: true });
    has('...and reads it when asked', r.plainText, 'Quotation No.: DQ-1');
    eq('one page', (r.pages || []).length, 1);
    // Blank-line-separated paragraphs, the same shape the layout pass hands
    // summarizePages for a PDF -- which is what makes a text file's labelled
    // line an Extracted Field by the ordinary rules rather than a second copy
    // of them.
    eq('...split into paragraph blocks, not one block per line',
      (r.pages[0].blocks || []).length, 2);
    ok('a labelled line becomes a field the ordinary way',
      (r.fields || []).some(f => /quotation/i.test(f.label)), (r.fields || []).map(f => f.label));
  }

  {
    // The UTF-8 BOM is TextDecoder's job and it does it: a hand-rolled
    // /^﻿/ replace here was dead code, which a mutation of it proved by
    // changing nothing. Asserted anyway, because the guarantee is what the
    // engine now leans on.
    const bom = new File([Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]),
      Buffer.from('Quotation No.: DQ-2', 'utf8')])], 'bom.txt');
    const r = await parseFile(bom, () => {}, { textAttachments: true });
    ok('a UTF-8 BOM does not survive into the first line',
      r.plainText.charCodeAt(0) !== 0xFEFF, r.plainText.slice(0, 12));
    ok('...so the label on that line is read',
      (r.fields || []).some(f => /quotation/i.test(f.label)), (r.fields || []).map(f => f.label));
  }

  {
    // UTF-16 is the BOM that actually has to be read, and Notepad is why: its
    // "Unicode" save is UTF-16LE. Through a UTF-8 decoder those bytes come back
    // as mojibake with a NUL after every character — unreadable on screen,
    // every label missing, and nothing anywhere reporting a problem.
    const utf16 = new File([Buffer.concat([Buffer.from([0xFF, 0xFE]),
      Buffer.from('Quotation No.: DQ-3', 'utf16le')])], 'unicode.txt');
    const r = await parseFile(utf16, () => {}, { textAttachments: true });
    has('a UTF-16LE text file is decoded, not mojibake', r.plainText, 'Quotation No.: DQ-3');
    hasNot('...with no replacement characters left in it', r.plainText, '�');
    hasNot('...and no NUL between the characters', r.plainText, ' ');

    const be = Buffer.from('Quotation No.: DQ-4', 'utf16le').swap16();
    const r2 = await parseFile(new File([Buffer.concat([Buffer.from([0xFE, 0xFF]), be])],
      'unicode-be.txt'), () => {}, { textAttachments: true });
    has('big-endian too — the BOM is what says which', r2.plainText, 'Quotation No.: DQ-4');
  }

  {
    const empty = new File([Buffer.alloc(0)], 'empty.txt');
    const r = await parseFile(empty, () => {}, { textAttachments: true });
    eq('an empty text file is a parsed document, not a failed one', (r.pages || []).length, 1);
    // And it keeps one empty BLOCK. summarizePages is happy with none, so the
    // page count alone cannot tell the two apart -- but a doc with no block
    // gives the pane nothing at all to draw, which is the download panel again.
    eq('...and still carries one block, so the pane has something to draw',
      ((r.pages[0] || {}).blocks || []).length, 1);
  }

  eq('a .csv is NOT read as text -- it is a SHEET_EXTS member and reads as a grid',
    TEXT_EXTS.includes('csv'), false);
  eq('...nor is .html, which already has an html preview', TEXT_EXTS.includes('html'), false);

  /* ---------- 3. the App: which extension previews as what ---------- */

  eq('.eml previews as text when there was no HTML body to keep', app.previewKindForExt('eml'), 'text');
  eq('.msg the same', app.previewKindForExt('msg'), 'text');
  eq('.txt unchanged', app.previewKindForExt('txt'), 'text');
  eq('.log reads as text', app.previewKindForExt('log'), 'text');
  eq('.xlt is a sheet, not text', app.previewKindForExt('xlt'), 'sheet');
  eq('.pdf is unmoved', app.previewKindForExt('pdf'), 'pdf');
  eq('.mht is unmoved', app.previewKindForExt('mht'), 'html');
  // A .xml attachment is as likely to be Excel 2003 SpreadsheetML as text, and
  // showing a workbook as a wall of tags is worse than offering a download.
  eq('.xml is deliberately left alone', app.previewKindForExt('xml'), 'other');
  eq('an unknown format still refuses', app.previewKindForExt('zip'), 'other');

  {
    // The App's list is deliberately WIDER than the engine's -- eml/msg are
    // containers, not text files, and are in it for the email whose body was
    // plain text. What must hold is containment: a format the engine reads as
    // text and the App calls 'other' gets a download button instead of a pane.
    const missing = TEXT_EXTS.filter(e => !app.VIEWER_TEXT_EXTS.includes(e));
    ok('every format the engine reads as text previews as text in the App', missing.length === 0, missing);
  }

  {
    // One extension, one preview kind. Two lists that overlap give a format
    // whose answer depends on the order the branches happen to sit in.
    const sheets = app.VIEWER_SHEET_EXTS;
    const clash = app.VIEWER_TEXT_EXTS.filter(e => sheets.includes(e));
    ok('no extension is claimed by both the text list and the spreadsheet list', clash.length === 0, clash);
    ok('...nor by the text list and the drop list disagreeing about it',
      app.VIEWER_TEXT_EXTS.every(e => typeof e === 'string' && e === e.toLowerCase()), app.VIEWER_TEXT_EXTS);
  }

  /* ---------- 4. textLinesFor ---------- */

  eq('no doc, no lines', app.textLinesFor(null), null);
  eq('a parsed doc with nothing in it has no text preview',
    app.textLinesFor({ status: 'parsed', textBlock: '   \n  ' }), null);

  ok('the dropped email\'s own body wins -- selfDocFor already split it',
    JSON.stringify(app.textLinesFor({ isSelf: true, textLines: ['Subject: x', '', 'body'] }))
      === JSON.stringify(['Subject: x', '', 'body']));

  {
    const lines = app.textLinesFor({
      status: 'parsed', fileName: 'notes.txt',
      textBlock: '=== Attachment: notes.txt ===\n\nSerial 12345\nQty 2',
    });
    ok('a parsed attachment previews from textBlock -- the field no preview used to read',
      JSON.stringify(lines) === JSON.stringify(['Serial 12345', 'Qty 2']), lines);
  }

  // The header belongs to the container's plainText, not to the document, and a
  // reviewer reading "=== Attachment: notes.txt ===" above the text would
  // reasonably think it was in the file.
  ok('the container\'s own === Attachment: === header is not part of the document',
    (app.textLinesFor({ status: 'parsed', textBlock: '=== Attachment: a.txt ===\n\nx' }) || [])
      .join('\n').indexOf('===') === -1);

  // applyAttachmentResult writes its own apology into textBlock for these two,
  // and rendering it in the text pane presents the engine's error message as
  // the document's contents.
  eq('a skipped document keeps the download panel',
    app.textLinesFor({ status: 'skipped', textBlock: '[Attachment: x.docx] — unsupported file type, skipped' }), null);
  eq('...and so does a failed one',
    app.textLinesFor({ status: 'failed', textBlock: '[Attachment: x.pdf] — failed to parse (boom)' }), null);
  eq('an inline signature logo is not offered as text either',
    app.textLinesFor({ status: 'inline', textBlock: '' }), null);

  /* ---------- 5. PreviewPane draws it ---------- */

  const noop = () => {};
  function pane(doc, entry) {
    return renderToStaticMarkup(React.createElement(app.PreviewPane, {
      doc, entry: entry || {}, url: 'blob:x', page: 1, setPage: noop,
      zoom: 'fit', setZoom: noop, onLoaded: noop, sheetIndex: 0, setSheetIndex: noop,
    }));
  }

  {
    const html = pane({
      fileName: 'notes.txt', ext: 'txt', previewKind: 'text', status: 'parsed',
      blob: {}, textBlock: '=== Attachment: notes.txt ===\n\nSerial 12345',
    });
    has('a parsed .txt ATTACHMENT now previews', html, 'Serial 12345');
    hasNot('...instead of the download panel it used to get', html, 'Download original');
  }

  {
    // The nested email of gap 2, in the shape applyAttachmentResult leaves it
    // when the inner mail had no HTML body at all.
    const html = pane({
      fileName: 'FW request.msg', ext: 'msg', previewKind: 'other', status: 'parsed',
      blob: {}, textBlock: '=== Attachment: FW request.msg ===\n\nSubject: PR REQUEST\n\nPlease action',
    });
    has('an email inside an email previews its body', html, 'Subject: PR REQUEST');
    has('...all of it', html, 'Please action');
  }

  {
    const html = pane({
      fileName: 'request.msg', ext: 'msg', previewKind: 'html', status: 'parsed',
      blob: {}, previewHtml: '<p>Dear <b>all</b></p>',
      textBlock: '=== Attachment: request.msg ===\n\nDear all',
    });
    has('an email WITH an HTML body renders it', html, '&lt;p&gt;Dear &lt;b&gt;all&lt;/b&gt;&lt;/p&gt;');
    ok('...through the sandboxed frame, never the page', html.includes('sandbox=""'), html.slice(0, 300));
  }

  {
    const html = pane({
      fileName: 'archive.zip', ext: 'zip', previewKind: 'other', status: 'skipped',
      blob: {}, textBlock: '[Attachment: archive.zip] — unsupported file type, skipped',
    });
    has('a format nothing can read still gets the honest download panel', html, 'Download original');
    hasNot('...and the engine\'s own apology is not presented as its contents', html, 'unsupported file type');
  }

  {
    // Order matters: a PDF has a real rendering and must not lose it to a text
    // dump just because its text was also parsed.
    const html = pane({
      fileName: 'contract.pdf', ext: 'pdf', previewKind: 'pdf', status: 'parsed',
      blob: {}, textBlock: '=== Attachment: contract.pdf ===\n\nAgreement Number L26',
    });
    hasNot('a PDF keeps its own renderer even though its text would preview', html, 'Agreement Number L26');
  }

  /* ---------- 6. Print says the same thing Preview does ---------- */

  {
    const doc = {
      fileName: 'notes.txt', ext: 'txt', previewKind: 'text', status: 'parsed',
      blob: {}, textBlock: '=== Attachment: notes.txt ===\n\nSerial 12345',
    };
    const p = app.printableFor(doc, {}, 'blob:x');
    eq('a text attachment is printable', p.mode, 'html');
    has('...from the same lines the pane drew', p.html, 'Serial 12345');
    hasNot('...header included in neither', p.html, '=== Attachment');
  }

  {
    const doc = {
      fileName: 'FW request.msg', ext: 'msg', previewKind: 'other', status: 'parsed',
      blob: {}, textBlock: '=== Attachment: FW request.msg ===\n\nSubject: PR REQUEST',
    };
    eq('a nested email whose extension resolves to "other" still prints', app.printableFor(doc, {}, 'blob:x').mode, 'html');
  }

  {
    const doc = {
      fileName: 'x.zip', ext: 'zip', previewKind: 'other', status: 'skipped',
      blob: {}, textBlock: '[Attachment: x.zip] — unsupported file type, skipped',
    };
    const p = app.printableFor(doc, {}, 'blob:x');
    eq('and the two refuse together', p.mode, 'none');
  }

  {
    // The blob check still sits above everything the bytes are needed for, and
    // the three kinds fed by the parse tree still print without one.
    const p = app.printableFor({ fileName: 'n.txt', previewKind: 'text', status: 'parsed',
      textBlock: 'body text' }, {}, null);
    eq('a dropped blob does not stop text from printing -- it came from the parse tree', p.mode, 'html');
  }

  /* ---------- 7. every call site asks for the opts ---------- */
  //
  // An opt defaulting to the old behaviour is only useful if the App actually
  // passes it, and there is no other way to notice a call site that was missed:
  // the feature simply does not appear for whichever upload path it was.

  {
    const calls = appSrc.match(/DocparseEngine\.(parseFile|resumeDeferredOcr)\(/g) || [];
    eq('the App has four engine parse call sites', calls.length, 4);
    const withOpts = (appSrc.match(
      /emailPreviewHtml: true, nestedEmails: true, textAttachments: true/g) || []).length;
    eq('...and every one of them asks for all three opts', withOpts, 4);
  }

  /* ---------- report ---------- */

  if (failures.length) {
    console.log(`${passed} passed, ${failures.length} failed`);
    failures.forEach(f => console.log('  FAIL  ' + f));
    process.exit(1);
  }
  console.log(`${passed} passed, 0 failed`);
})().catch(err => {
  console.log('threw: ' + (err && err.stack || err));
  process.exit(1);
});
