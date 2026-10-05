# App harness (no browser)

The `PR Assistant App.html` counterpart to `_test/_test/harness/`, which does the
same job for `Docparse/docparse-engine.js`.

**This directory is version-controlled; `_test/_test/` is not.** Only
`_test/_test/` is in `.gitignore`, because that is the one holding the real
corpus (`.eml`/`.pdf` contracts) and the `ab-dump` snapshots. These tests carry
no corpus document at all — see Fixtures below — so they belong in the repo.

```
node _test/app-harness/crosscheck.test.js    # pure functions, React stubbed
node _test/app-harness/render.test.js        # real components, real React
node _test/app-harness/recordid.test.js      # Record_ID fallback chain
node _test/app-harness/save.test.js          # buildRecordPayload
node _test/app-harness/outlook-drop.test.js  # dropping a mail dragged from Outlook
node _test/app-harness/extracted-fields.test.js  # the Process -> Verify preview grid
node _test/app-harness/quotation-fields.test.js  # what a vendor quotation contributes
node _test/app-harness/agreement-fields.test.js  # what a SCANNED agreement contributes
node _test/app-harness/chop-owner.test.js    # whose chop / whose signature
node _test/app-harness/n8n-send.test.js      # which documents "Send to n8n" posts
node _test/app-harness/sheet-fields.test.js  # what a spreadsheet's CELLS contribute
node _test/app-harness/table-fields.test.js  # what a PDF table's ROWS contribute
node _test/app-harness/email-subject.test.js # what the email SUBJECT contributes
node _test/app-harness/email-preview.test.js # what the viewer can SHOW
```

All exit non-zero on failure. None needs a browser, a server or the corpus.
Four of them reach into the ENGINE rather than the App: `chop-owner.test.js`
(`attachMarkContext`), `sheet-fields.test.js` (`extractFieldsFromSheet`),
`table-fields.test.js` (`fieldsFromTable`) and `email-preview.test.js`
(`buildEmailPreviewHtml`, which is pure over `{contentId, mimeType, getContent}`
descriptors — no MsgReader, no postal-mime, no canvas; and `parseFile` itself on
a `.txt`, which needs no library at all, so **both sides** of the
`textAttachments` opt run here — the two-argument call still throwing
`Unsupported file type: .txt` is the half `ab-diff` cannot check, because
`ab-dump.js` only looks at pdf/xlsx/xls). That last one also reads
both source files as text, to pin the two engine opts as opts and to count the
App call sites that pass them: an opt the App forgot to ask for does not fail,
the feature simply never appears for that upload path. The root `CLAUDE.md` explains why
the first works under plain Node; the other two work because by the time those
functions are called the input is already plain strings — rows of cells. The
sheet one stubs `XLSX.utils.sheet_to_json`, its only call into XLSX, so the
fixture IS the cell grid; the table one takes rows directly. In both cases that
is the thing worth reading in a test about layout.

An engine change still needs `ab-diff` on top of these. They cover three
functions' rules, not the engine's compatibility guarantee toward
`Docparse/index.html` — and `ab-diff` is text-layer only, so a change that only
shows up on a scanned page needs the browser ladder in `Docparse/CLAUDE.md` as
well. The award-letter fixture in `table-fields.test.js` came from exactly that:
a browser run, because the document has no text layer for Node to read.

## Not covered here yet

Everything reachable without a browser now is. The three behaviours this section
used to list — the `To`-fallback reject for an email-header name fragment
(`"Cheung,"`), `hkdTotalFromText`, and the vendor-based half of
`offItemQuotationTest` — are all in `quotation-fields.test.js` as of the pass that
added them.

Each was checked by mutation, not just by going green: removing
`NAME_FRAGMENT_PATTERN` from the reject, stubbing out `hkdTotalFromText`'s call
site, widening `HKD_TOTAL_LINE` to accept USD, and blanking `itemVendor` each make
this file fail. Worth repeating for anything added here — a fixture that asserts
the shape of a value the code never produced passes forever.

`email-subject.test.js` was built the same way and the check earned its keep:
ten mutations of `parseEmailSubject`, and on the first run one of them — taking
the FIRST bracketed `(N-…)` group rather than the last — stayed green, because
no fixture then carried two of them. The "(10-Gigabit uplink) … (2-BData)"
subject exists to close that hole. Two others, `\b` for the BTB boundary and
`[^)]` for the vendor's own nested brackets, are the mutations the real subjects
already covered.

What is left is the browser half, and no test in this directory can reach it: the
App's actual upload → Process → Verify screens, `goProcess`'s OCR-resume closure,
`handleAddDocument`, and `goSave`'s create-record loop. See *When it will lie to
you* below, `Docparse/CLAUDE.md` for the engine-side ladder, and the root
`CLAUDE.md` for the measurements that ladder has already produced.

## How it works

`app.js` reads `PR Assistant App.html` as text, cuts out the
`<script type="text/babel-jsx" id="app-src">` block, drops the
`ReactDOM.createRoot(...).render(<App />)` line at the bottom — the block's only
top-level side effect and the only line that needs a DOM — compiles the JSX with
`@babel/standalone`, and runs the result in a `vm`.

Two things are easy to get wrong here:

- **Top-level `const` never lands on the sandbox global.** Function declarations
  do; `DEMO_ATTACHMENTS`, `DOC_ROLES`, `DIFF_KEYS` and every other `const` do
  not. `app.js` appends an explicit `globalThis.__app = {…}` built from the
  `EXPORTS` list. The list is resilient: a name that does not exist yet comes
  back `undefined` rather than throwing, so the harness keeps working while the
  functions it names are still being written.
- **`load()` stubs React; `load({ react: true })` uses the real one.** The stub
  (`useMemo: f => f()`, `useState: v => [v, noop]`) is enough to reach the pure
  functions and cannot render a tree. `render.test.js` needs the real React and
  `react-dom/server`.

`renderToStaticMarkup` never runs effects, which is fine — every effect in the
App is object-URL and keyboard plumbing that needs a browser anyway. What it does
cover is the render pass.

## Fixtures

`demoClone(app)` deep-clones `DEMO_ATTACHMENTS`; `setDemoField(att, typeKey,
label, value)` edits one extracted field on the clone. Every conflict case is
built this way, so invented values never enter the shipped file and **no corpus
document is touched at any point**. `setDemoField` throws if the label is gone,
so a fixture change breaks the test rather than silently asserting nothing.

## Setup

```
cd _test && npm i @babel/standalone react@18 react-dom@18
```

`_test/` is the right home for these: `Docparse/` must stay dependency-free, and
`worker/` is a different project.

## The Outlook drop test is the odd one out

`outlook-drop.test.js` fakes a `DataTransfer` rather than using
`DEMO_ATTACHMENTS`, because what it is pinning down is a browser API contract,
not the App's data: Outlook hands over a *virtual* file, so
`dataTransfer.files` is empty and only `webkitGetAsEntry()` reaches the bytes.
It also reads `Docparse/index.html` as text and asserts that its copy of the
three functions has not drifted from the App's — the two apps share
`docparse-engine.js` and nothing else, so the copies are kept in step by that
assertion and by nothing else. Quote style and wrapping may differ; a statement
may not.

## When it will lie to you

- It proves nothing about layout. A capsule that overflows its 300px cell passes
  here.
- Effects, focus, keyboard handling and object URLs are all unexercised.
- `DEMO_ATTACHMENTS` carries no `blocks`, so heading-based role classification
  (`docHeadingLines` → `headingRoleOf`) never fires. Demo role assignment
  exercises only the filename and tab branches.
- No demo document carries `signing`, so `PROMOTED_BY_SIGNING` never fires either.
- The Outlook drop test proves the *handler* is right, never that Chrome hands a
  real Outlook mail over in the shape the fakes assume. Only a real drag from a
  real Outlook proves that, and nothing here can do it.
- `DocparseEngine` is `undefined` in the sandbox, so nothing that talks to the
  engine is exercised: the `goProcess` resume closure, `handleAddDocument`, and
  the `ocrBudgetMs` both of them now pass. Whether that budget actually bounds a
  scanned read is a browser question — `Docparse/CLAUDE.md` has the ladder, and
  the measurement it produced is recorded in the root `CLAUDE.md`.
- `render.test.js` asserts markup by substring — a class name, a title, a piece
  of copy. It tells you a marker is present, never that it is *visible*: a
  capsule rendered behind a collapsed pane passes here. Rewording a string in
  the App will fail this file, and that is the intended trade — the failure is
  the notification.

## A note on where the conflict marks live

Page 1's editable field grid became a read-only panel in the upload/parse
redesign. `renderFieldInput` — ring, flag button, capsules, compare panel — is
now rendered only by the document viewer's "Extracted Field" tab, so
`render.test.js` drives that function directly instead of reaching it through
`UploadPage`, and asserts that page 1 draws no ring of its own. If the grid
comes back, that pair of assertions is where to say so.

`extracted-fields.test.js` was rewritten once already: its columns used to be
attachment tabs (`extractedCellValue(diff, typeKey)`), which could not work
once a whole email arrived under one tab. They became `DOC_ROLES` roles, read
through `roleCellValue(crosschecks, key, roleKey, kind)`.

It was rewritten a second time when the Verify Table itself collapsed from a
document-vs-document grid (Agreement / Quotation / ATQ (Excel) / Email
Subject, one column each) down to **Field + one Value column**, sourced from
`roleCellValue(..., "atq", "excel")`. Agreement, Quotation and the email
subject still feed the conflict signal that colours that one value —
`crosschecks[key].severity`, via the new `verifyValueTone(cc, value)` — they
just no longer draw a column of their own by default.

A flagged row (severity `different` or `similar`) can still be opened to see
what the OTHER document(s) said: the value is wrapped in a plain `<details>`
whose body renders a small table, one row per source, still resolved the same
way as the old four-column grid (`verifyCellValue`, `columnDocSource`, the
Dataverse badge, the per-document open button). Two things changed from the
first pass at this breakdown, both from user feedback on the actual redesign:

- **Which sources it offers is per-field, not always all three.** A second
  constant, `FIELD_ROW_CONFIG`, says for each row in `EXTRACTED_FIELD_ROWS`
  which roles it is even comparable against — Customer Name / Vendor / Total
  Value (HKD) / Start Date / End Date genuinely appear on Agreement, Quotation
  *and* the ATQ workbook (`compare: ["agreement", "quotation"]`); Agreement
  Number only ever appears on the Agreement (`compare: ["agreement"]`);
  Quotation No. only ever appears on the Quotation (`compare: ["quotation"]`).
  Offering a column that could never have produced the disagreement (Agreement
  Number vs. the Quotation, which never states one) used to just print "not
  extracted" and teach a reviewer to ignore it.
- **ATQ (Excel) is never one of its own breakdown rows.** `config.compare`
  never names `"atq"` — the row's OWN value already is the ATQ (Excel)
  reading, so repeating it inside the panel it belongs to would show a value
  as its own second witness.

`FIELD_ROW_CONFIG` also carries two rows with no comparison at all:
**Product Type / Service Type / Back-to-Back** (`solo: true`) only ever come
from the ATQ workbook, so nothing is ever asked of another document and
nothing is ever flagged, however the keys still sit in `DIFF_KEYS` for other
consumers (Verify's own Automatic Checks). **Quotation No.** is a comparison
only *conditionally*: `soloRole: "quotation"` is the fallback for when the ATQ
workbook left the field blank (a real, measured shape — see CLAUDE.md's note
on `ATQ-202603-00386-V23`) — the row then shows the Quotation document's own
reading directly, plainly, rather than reporting "not extracted" for a value
one document plainly states.

`<details>` rather than React state, still on purpose: the breakdown is then
part of the static markup this harness renders, directly assertable with
`.includes(...)`, instead of a click `renderToStaticMarkup` cannot simulate.
This is also why two call sites opt into `openViewer`'s single-document `only`
argument (`render.test.js`'s "single-document view" assertions), not one — the
column header and the breakdown panel's per-source buttons both open the one
document a value was actually read from, for the same reason.

`verifyValueTone` is the only new pure function the first pass added: it maps
`same` / `similar` / `different` / `unchecked` to a text class, a background
chip class and a glyph, on the
deliberate rule that only `different` gets weight and a loud colour — an
agreeing or uncorroborated cell stays plain text, so a reviewer's eye lands on
a real conflict and nowhere else. Its `title` is `crosscheckSentence(cc)`,
the same sentence Verify's own Automatic Checks panel uses, so the two
surfaces can never disagree about why a cell is flagged. The value text itself
still carries that tone; a separate chevron icon (`Icon name="chevronDown"`,
added to the shared icon set) is what says "click to compare" — the earlier
version made the whole flagged value double as its own disclosure trigger,
which read as a link rather than as a value in question.

Three of that table's rows are not per-document and are listed in
`SPANNING_ROWS` rather than resolved as ordinary rows: **ATQ Ref. No.**, the
workbook's own reference number; **UID #**, stated by the email subject; and
**Record ID**, derived from the ATQ reference and the item number. None of the
three is a thing a document "disagrees" about, so all three draw in a
reference strip above the table (and the legend) instead of as comparison
rows — `atqRefNo` moved there in the second redesign pass, having previously
sat in `EXTRACTED_FIELD_ROWS` as an ordinary (if always-uncontested) row.
`uid` used to be an ordinary cross-check row and printed "not extracted" four
times on every upload, because no document reports a UID as a labelled field —
the note on `DIFF_KEYS` says so in as many words. The test asserts that every
row in `EXTRACTED_FIELD_ROWS` is either cross-checked or declared a spanning
row, and — now the opposite of what it originally asserted — that no spanning
row is *also* in that list, since the two are rendered in different places and
would otherwise draw twice.

`recordIdForItem` reads off `savePlans`, the list `goSave` actually writes from,
so the `-a`/`-b` suffix `assignRecordIds` adds on a collision reaches the
preview too. There is an assertion for exactly that, because a preview that
recomputed the ID from `recordIdFor` would look right and drop the suffix.

`EXTRACTED_EMAIL_COLUMN`, kept deliberately out of `EXTRACTED_FIELD_COLUMNS`
so that anything iterating "the documents" keeps meaning the documents, no
longer has a column to draw on this page — the redesign removed the witness
column from the table itself. `subjectVerdict` stays as a pure function,
graded by the cross-check's own rules — the key's normaliser, `tokenJaccard`
for `FUZZY_DIFF_KEYS`, `listParts` for a collapsed column — with no render
call left in `ExtractedFieldsPage`; the fixtures below exist only because a
mutation survived without them, independent of whether anything on screen
draws the result:

- `normName` reduces "ABC Company Ltd" and "ABC Company Limited" to the same
  string, so a Ltd/Limited fixture never reaches the fuzzy branch and deleting
  the branch stayed green. The pair that tests it has to normalise to two
  *different* strings scoring at `DIFF_JACCARD_MIN`.
- `crosschecks.uid` does not exist at all, so asserting silence through it never
  reached the `!said.length` guard. Silence needs a crosscheck that exists and a
  role that says nothing.
- Every single-value fixture makes `some` and `every` behave identically. The
  two-value one is the real case: the Cost worksheet and the ATQ sheet name
  different vendors and the subject sides with one of them.
