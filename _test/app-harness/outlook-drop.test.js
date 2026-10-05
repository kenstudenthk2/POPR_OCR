// Assertions for dropping a mail dragged straight out of Outlook.
//
//   node _test/app-harness/outlook-drop.test.js
//
// No framework, same as crosscheck.test.js: a rung-0 check that needs an install
// before it will run is a rung-0 check nobody runs.
//
// What is being pinned down: Outlook does not hand the browser a file on disk.
// The mail lives in the .ost/.pst or on Exchange, so Outlook offers it as a
// *virtual* file and `dataTransfer.files` comes back EMPTY. The only route to
// the bytes is `DataTransferItem.webkitGetAsEntry()`. Every fake below is a
// DataTransfer stand-in; no real Outlook, no corpus document, no browser.

const fs = require('fs');
const path = require('path');
const { load, APP_PATH } = require('./app.js');
const app = load();

const DOCPARSE_PATH = path.join(__dirname, '..', '..', 'Docparse', 'index.html');

let passed = 0;
const failures = [];

function ok(label, cond, detail) {
  if (cond) { passed++; return; }
  failures.push(label + (detail === undefined ? '' : '\n      got: ' + JSON.stringify(detail)));
}
function eq(label, actual, expected) {
  ok(label, JSON.stringify(actual) === JSON.stringify(expected),
    actual === undefined ? 'undefined' : { actual, expected });
}

/* ---------- DataTransfer stand-ins ---------- */

// What Explorer sends: real files, already on disk.
function explorerDrop(names) {
  return {
    files: names.map(n => new File(['x'], n)),
    items: names.map(() => ({ kind: 'file', webkitGetAsEntry: () => { throw new Error('not reached'); } })),
    types: ['Files'],
  };
}

// What Outlook sends: `files` empty, one item per mail, `getAsFile()` null, and
// the bytes only behind webkitGetAsEntry(). `calls` records when the entry was
// asked for, so the synchronous-discipline test below can check the timing.
function outlookDrop(entryNames, opts) {
  const o = opts || {};
  const calls = [];
  return {
    calls,
    files: [],
    items: entryNames.map(name => ({
      kind: 'file',
      getAsFile: () => null,
      webkitGetAsEntry: () => {
        calls.push(name);
        return {
          name,
          isFile: !o.directory,
          isDirectory: !!o.directory,
          file: (resolve, reject) => {
            if (o.failing) { reject(new Error('mail could not be materialised')); return; }
            resolve(new File(['mail bytes'], name));
          },
        };
      },
    })),
    // Outlook always puts the mail on the clipboard as HTML and text too.
    types: ['Files', 'text/html', 'text/plain'],
  };
}

// A drag carrying no file at all -- selected text, a link, a mail dragged in a
// browser that does not pass virtual files on.
function textOnlyDrop() {
  return {
    files: [],
    items: [{ kind: 'string', type: 'text/html' }],
    types: ['text/html', 'text/plain'],
  };
}

/* ---------- the tests ---------- */

async function main() {
  /* An ordinary drop from Explorer must take the path it always took. This is
     the regression guard on the change itself: `files` wins, and the File
     objects arrive by identity, not rebuilt. */
  const explorer = explorerDrop(['ATQ-202604-00177.xlsx', 'quote.pdf']);
  const fromExplorer = await app.collectDroppedFiles(explorer).files;
  eq('Explorer drop keeps every file, in order',
    fromExplorer.map(f => f.name), ['ATQ-202604-00177.xlsx', 'quote.pdf']);
  ok('Explorer drop hands back the very same File objects',
    fromExplorer[0] === explorer.files[0]);
  eq('Explorer drop carries no failure message',
    app.collectDroppedFiles(explorer).emptyMessage, '');

  /* The feature: a mail dragged out of Outlook. `files` is empty, so this used
     to resolve to nothing and the drop was silently ignored. */
  const outlook = outlookDrop(['RE Quotation QT-2600008.msg']);
  const fromOutlook = await app.collectDroppedFiles(outlook).files;
  eq('Outlook mail arrives as one file despite an empty dataTransfer.files',
    fromOutlook.map(f => f.name), ['RE Quotation QT-2600008.msg']);
  ok('Outlook mail carries its bytes', fromOutlook[0].size > 0);

  /* Several mails selected and dragged together. */
  const many = outlookDrop(['first.msg', 'second.msg', 'third.msg']);
  const fromMany = await app.collectDroppedFiles(many).files;
  eq('every mail in a multi-mail drag survives',
    fromMany.map(f => f.name), ['first.msg', 'second.msg', 'third.msg']);

  /* The engine routes on extension alone, so an item that arrives without one
     would be turned away as unsupported when it is in fact a mail. */
  const bare = await app.collectDroppedFiles(outlookDrop(['Fwd Contract renewal'])).files;
  eq('an extension-less Outlook item is named .msg so the engine will route it',
    bare.map(f => f.name), ['Fwd Contract renewal.msg']);

  /* ...but an attachment dragged out of a mail keeps its own extension. */
  const attach = await app.collectDroppedFiles(outlookDrop(['ATQ-202604-00177.xlsx'])).files;
  eq('an attachment dragged out of a mail keeps its own extension',
    attach.map(f => f.name), ['ATQ-202604-00177.xlsx']);

  /* An Outlook item is named after its SUBJECT, and a subject can end in
     something extension-shaped that no parser handles. Guessing from the shape
     instead of the real list sends the engine a ".1" and the mail is rejected
     as unsupported -- the exact failure this whole change exists to remove. */
  const dotted = await app.collectDroppedFiles(outlookDrop(['Quote for site A.1'])).files;
  eq('a subject ending in a non-extension is still read as a mail',
    dotted.map(f => f.name), ['Quote for site A.1.msg']);
  const versioned = await app.collectDroppedFiles(outlookDrop(['RE pricing v1.2'])).files;
  eq('a subject ending in a version number is still read as a mail',
    versioned.map(f => f.name), ['RE pricing v1.2.msg']);
  const upper = await app.collectDroppedFiles(outlookDrop(['SCAN 0042.PDF'])).files;
  eq('an upper-case extension is recognised and left alone',
    upper.map(f => f.name), ['SCAN 0042.PDF']);

  /* THE trap in this API. The DataTransfer is neutered the moment the drop
     handler yields, so webkitGetAsEntry() has to be called before the function
     returns -- not inside the promise. Reading `items` after the fact throws
     here, exactly as the browser would hand back an empty list. */
  const late = outlookDrop(['timing.msg']);
  const pending = app.collectDroppedFiles(late);
  ok('the entry is claimed synchronously, before the handler yields',
    late.calls.length === 1, late.calls);
  Object.defineProperty(late, 'items', {
    get() { throw new Error('DataTransfer read after the drop handler returned'); },
  });
  const afterNeutering = await pending.files;
  eq('the mail still resolves after the DataTransfer is neutered',
    afterNeutering.map(f => f.name), ['timing.msg']);

  /* A folder was never accepted here and this change is not the place to start:
     skipped, not walked, and not crashed on. */
  const folder = await app.collectDroppedFiles(outlookDrop(['Some folder'], { directory: true })).files;
  eq('a dropped directory is skipped rather than walked', folder.map(f => f.name), []);

  /* One entry failing must not sink the others in Promise.all. */
  const failing = await app.collectDroppedFiles(outlookDrop(['broken.msg'], { failing: true })).files;
  eq('an entry that cannot be materialised drops out instead of rejecting',
    failing.map(f => f.name), []);

  /* When nothing usable came through, the user has to be told why -- the old
     handler's silence is the actual defect being fixed. */
  const textOnly = app.collectDroppedFiles(textOnlyDrop());
  eq('a text-only drag yields no files', (await textOnly.files).length, 0);
  /* An empty DataTransfer must not throw on the way to that message. */
  const nothing = app.collectDroppedFiles({ files: null, items: null, types: null });
  eq('a drop with nothing on it yields no files', (await nothing.files).length, 0);

  /* The regression that actually shipped: the guidance used to live only on the
     branch for a drag that also carried text/html or text/plain, because a mail
     "obviously" brings its body along. A real drag out of the new Outlook took
     the other branch and produced a dead end. Every no-file drop now says the
     same useful thing, whatever else was on the clipboard. */
  eq('every no-file drop gives the identical message',
    textOnly.emptyMessage, nothing.emptyMessage);

  [['text-only drag', textOnly], ['empty drag', nothing]].forEach(([what, drop]) => {
    // The message has to be right for the Outlook the reader is actually
    // running: new Outlook saves .eml, not .msg, so a fallback naming only
    // ".msg" sends that user hunting for a file they will never have.
    ok(what + ' names Outlook and gives a fallback',
      /Outlook/.test(drop.emptyMessage) && /desktop/.test(drop.emptyMessage),
      drop.emptyMessage);
    ok(what + ' names both save formats, not just .msg',
      /\.eml/.test(drop.emptyMessage) && /\.msg/.test(drop.emptyMessage),
      drop.emptyMessage);
    ok(what + ' distinguishes new Outlook from classic',
      /new Outlook/.test(drop.emptyMessage) && /[Cc]lassic/.test(drop.emptyMessage),
      drop.emptyMessage);
    ok(what + ' offers the in-Outlook route as well as the desktop one',
      /Save as/.test(drop.emptyMessage), drop.emptyMessage);
  });

  /* Docparse/index.html carries the same three functions, because the two apps
     share docparse-engine.js and nothing else, and Docparse takes no new
     required files. Everything above exercises the App's copy only, so without
     this the Docparse copy is covered by nothing but good intentions -- and a
     one-sided fix is the obvious way this breaks. Quote style and line wrapping
     are allowed to differ; a statement is not. */
  const twins = [DOCPARSE_PATH, APP_PATH].map(p => {
    const src = fs.readFileSync(p, 'utf8');
    const start = src.indexOf('function collectDroppedFiles');
    if (start < 0) throw new Error('collectDroppedFiles is gone from ' + path.basename(p));
    const tail = src.indexOf('application/vnd.ms-outlook', src.indexOf('function nameForParsing', start));
    const end = src.indexOf('}', src.indexOf('\n', tail)) + 1;
    return src.slice(start, end).split(/\r?\n/)
      .map(l => l.trim())
      .filter(l => l && !l.startsWith('//'))
      .map(l => l.replace(/'/g, '"').replace(/\s+/g, ' '));
  });
  ok('the Docparse copy has not drifted from the App copy',
    JSON.stringify(twins[0]) === JSON.stringify(twins[1]),
    twins[0].find((l, i) => l !== twins[1][i]) || 'differing statement count');

  /* ---------- report ---------- */
  if (failures.length) {
    console.error(`\n${failures.length} failed, ${passed} passed\n`);
    failures.forEach(f => console.error('  FAIL  ' + f));
    process.exit(1);
  }
  console.log(`outlook-drop: ${passed} passed`);
}

main().catch(err => { console.error(err); process.exit(1); });
