# PR Assistant — repo notes for future changes

## Git: two diverged branches, not yet reconciled

`origin/main` and the local work in this repo are two independently-developed
lines touching the same core files (`PR Assistant App.html`,
`Docparse/docparse-engine.js`, both `AGENTS.md`s) with essentially no content
overlap: `origin/main` has no deferred-OCR (`deferOcr`/`resumeDeferredOcr`)
architecture and still has the "Smart extract" (Gemini worker) feature;
`feature/deferred-ocr-process-verify-flow` has the deferred-OCR flow, the
Extracted Fields comparison page, and Smart extract removed. Local `main` is
its own third point (ahead of the old common ancestor, behind `origin/main`).

Until a human has compared the two lines and decided how to reconcile them:
- Do not merge, rebase, or force-push either line onto the other.
- New work continues on `feature/deferred-ocr-process-verify-flow`, pushed to
  GitLab as its own branch — not onto `main`.
- Do not assume `origin/main`'s version of a shared file (either `AGENTS.md`,
  the engine, or the App) reflects current reality; check which branch you are
  actually on before trusting file contents against these notes.

## Tech stack

`PR Assistant App.html` is one file: React 18 + Babel Standalone, both loaded from
`unpkg` via `<script>` tags, JSX compiled in-browser at load time. No build step,
no npm, no bundler, no `package.json` for the app itself — you edit the HTML file
directly and reload the page. Tailwind is loaded from the Tailwind CDN script, not
compiled. `PR Assistant App.html:1-32` is the entire head/script-tag setup; the
whole app lives in the `<script type="text/babel-jsx" id="app-src">` block that
follows.

`_test/` and `worker/` are separate Node projects with their own `package.json`;
they exist only to test the browser file, never to build it.

## Docparse/docparse-engine.js — the shared engine

`Docparse/docparse-engine.js` is loaded as a plain `<script>` and used by two
independent consumers:

- `Docparse/index.html` — the standalone Docparse tool, calls
  `DocparseEngine.parseFile(file, setStatus)` with exactly two arguments.
- `PR Assistant App.html` — this app, calls the same `parseFile` with a third
  `opts` argument (`{ deferOcr, retainForResume, ... }`, see below).

**Compatibility rule: every new engine parameter must be optional and default to
the old behaviour.** `index.html`'s two-argument call must never change output —
this is enforced by `ab-diff` (see Testing below), not by convention alone. Do not
assume you can change `index.html` to keep the engine simple; `index.html` is a
separate consumer you do not control the call sites of from this repo's App side.

The container-level aggregation inside the engine —
`reconcileOcrFields` / `dedupeAtqRecords` / `matchQuotationAttachments` /
`finalizeEmailResult` — depends on having *all* of an email's attachments in hand
at once. Do not move any of this into `PR Assistant App.html`: the App only ever
gets one document's worth of context at a time, and re-implementing
cross-document reconciliation there would either be wrong or duplicate the engine.
If the App needs different aggregation behaviour, the engine gains a new opt —
it does not get bypassed.

## The light-pass → Process → OCR → Verify → Save flow

Upload no longer runs OCR inline. `handleUpload` in `PR Assistant App.html` calls
`parseFile(file, onStatus, { deferOcr: true, retainForResume: true })`, which
returns in roughly a second even for a scanned-PDF-heavy email: text layers,
Excel, and the ink/signature pass all still happen eagerly; only per-page OCR on
scanned/pending pages is deferred. Deferred pages come back as
`{ ocrPending: true, blocks: [] }` and the result carries a `pendingDocs` list.

The user then reviews the four role slots (Agreement / ATQ / Quotation /
Customer PO) and clicks **Process**, which calls
`DocparseEngine.resumeDeferredOcr(prevResult, wantedDocIndexes, onStatus, opts)`
only for the documents that actually landed in a role slot — attachments nobody
assigned a role to are never OCR'd at all. `resumeDeferredOcr` re-runs
`parseByExt` per document (not a page-splice), reusing `seedMarks` so the ink
pass is not repeated. Only after Process succeeds does OCR content land in the
form fields (`detectFromRoles`, called from `goProcess`, guarded by each field's
own `auto === false` so a manual edit is never overwritten).

**Anti-pattern: do not run OCR eagerly on upload again.** The whole point of
`deferOcr` is that OCR only happens for documents a human has already assigned a
role to. If you find yourself wanting to trigger OCR before Process is clicked,
that is very likely the wrong fix — the role slots exist precisely so OCR is not
wasted on the other attachments of the email.

## `entry.parsed` — do not change its meaning

`entry.parsed` (on each of the four attachment-type entries in `attachments`)
means "a file was dropped and read", **not** "OCR has finished". Roughly eight
places in `PR Assistant App.html` gate on this flag assuming that meaning; it
stays `true` after a light-pass upload, before Process ever runs. Whether OCR is
still outstanding is tracked separately via `entry.phase` (`"light"` | `"full"`)
and `entry.pendingDocs`. If you need to know "has this attachment finished OCR",
check `phase`/`pendingDocs`, not `parsed`.

## Save — one Dataverse record per ATQ item

An ATQ email can cover several items (e.g. "Item 2 & 3"); Save writes one
`admin_purchaserequest` record per item, sequentially (not `Promise.all` —
Dataverse throttles, and a sequential loop leaves a describable partial state).
On a failure partway through, already-written records are kept — there is no
rollback — and `savedRecordIds` makes a retry idempotent (already-saved records
are skipped). `buildRecordPayload` is a pure function precisely so this can be
tested without a real `Xrm.WebApi`; keep new Save-payload logic inside it rather
than back inline in `goSave`.

⚠️ Naming trap: `App`'s `records` state is the Dataverse record list shown on the
Records page; `entry.records` (on an attachment) is the ATQ line items parsed out
of that document. The two are unrelated despite the shared name.

## Dataverse embedded mode vs. standalone/demo

The app is normally embedded as a Model-Driven App page and talks to Dataverse via
`parent.Xrm.WebApi` (`PR Assistant App.html:4218`, `:4538`). When
`parent.Xrm.WebApi` is not present — running the file standalone, or opened
outside the Model-Driven App frame — reads/writes fall back to local-only state
(the in-memory demo/empty record lists) instead of throwing. Any code that talks
to Dataverse should follow this same pattern: check for `parent.Xrm.WebApi`,
degrade to a local fallback rather than erroring, and log a `console.warn` so the
fallback is visible in dev tools. `demoMode` (toggled via the Demo button) is a
separate, unrelated switch that swaps between seeded example data and empty
state — it does not affect which Dataverse path is used.

## Testing — `_test/app-harness`

```
node _test/app-harness/crosscheck.test.js    # pure functions, React stubbed
node _test/app-harness/render.test.js        # real components, real React (renderToStaticMarkup)
node _test/app-harness/recordid.test.js      # Record_ID fallback chain + collision handling
node _test/app-harness/save.test.js          # buildRecordPayload
node _test/app-harness/outlook-drop.test.js  # Outlook drag-drop virtual-file handling
```

No framework, no build step, no browser — `_test/app-harness/app.js` reads
`PR Assistant App.html` as text, strips the JSX block out, compiles it with
`@babel/standalone`, and runs it in a Node `vm`. See
`_test/app-harness/README.md` for the mechanics (why `EXPORTS` is a list, why
`load({ react: true })` exists, what the harness cannot see).

**What this harness cannot cover**: anything behind a real DOM, a real event
loop, or `parent.Xrm.WebApi` — `useEffect` never runs under
`renderToStaticMarkup`, and there is no Dataverse to call. The actual `goProcess`
OCR-resume closure and the actual `goSave` create-record loop are only verified
by reading the code plus testing the pure functions they call
(`buildRecordPayload`, `recordIdFor`, `assignRecordIds`). Confirming the loops
themselves needs a real browser (`Docparse/AGENTS.md` has the ladder for the
engine's OCR side) and, for Save specifically, the real Model-Driven App — there
is no local substitute for `parent.Xrm.WebApi`.

When the engine changes, also run the `ab-diff` check described in
`Docparse/AGENTS.md` — the app-harness tests do not touch
`Docparse/docparse-engine.js`'s own compatibility guarantee toward
`Docparse/index.html`.

## Anti-patterns

- Don't move engine-level container aggregation (`reconcileOcrFields`,
  `dedupeAtqRecords`, `matchQuotationAttachments`, `finalizeEmailResult`) into
  `PR Assistant App.html`. It belongs in the engine because it needs every
  attachment of an email at once.
- Don't change what `entry.parsed` means. Add a new flag instead.
- Don't make a new engine parameter required, or change what a two-argument
  `parseFile` call does. `Docparse/index.html` depends on the two-argument
  behaviour staying exactly as it is.
- Don't run OCR before a document has a role assigned — that defeats the reason
  `deferOcr` exists.

- The n8n Verify Table must show only Record_ID and UID until its Dataverse
  Agreement and Quotation records exist; do not fall back to OCR values in that
  n8n state. Refresh may re-query those two tables without changing Record_ID or UID.
- Dataverse primary-name logical name for Record_ID in both BTB Agreement and
  BTB Vendor Quotation is lowercase `admin_title`; preserve that exact casing in
  Verify Table queries.
- Dataverse WebApi `$select` properties for these BTB tables are lowercase
  logical names even when the maker UI displays schema-style casing; use the
  lowercase property names in all Verify Table queries and mappings.
- Don't use `Promise.all` for the Save loop, and don't add rollback-on-failure —
  both are deliberate choices (throttling, and a half-rollback being worse than a
  recorded partial completion), not oversights.

- In the Verify Table, keep the chop display as the previous single `Company Chop`
  row with the chop thumbnail/details; do not replace it with separate `Chop Result`
  and `Chop attachment` rows.
- When asked to increase the Verify Table page font size for readability, apply
  the change to the whole Verify Table page, including notices, reference
  cards, table rows, helper labels, reminders, and Verify Table modals, not only
  the table cells.
