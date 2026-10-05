# PR Assistant — repo notes for future changes

## Git: two diverged branches, not yet reconciled

`origin/main` and the local work in this repo are two independently-developed
lines touching the same core files (`PR Assistant App.html`,
`Docparse/docparse-engine.js`, both `CLAUDE.md`s) with essentially no content
overlap: `origin/main` has no deferred-OCR (`deferOcr`/`resumeDeferredOcr`)
architecture and still has the "Smart extract" (Gemini worker) feature;
`feature/deferred-ocr-process-verify-flow` has the deferred-OCR flow, the
Extracted Fields comparison page, and Smart extract removed. Local `main` is
its own third point (ahead of the old common ancestor, behind `origin/main`).

Until a human has compared the two lines and decided how to reconcile them:
- Do not merge, rebase, or force-push either line onto the other.
- New work continues on `feature/deferred-ocr-process-verify-flow`, pushed to
  GitLab as its own branch — not onto `main`.
- Do not assume `origin/main`'s version of a shared file (either `CLAUDE.md`,
  the engine, or the App) reflects current reality; check which branch you are
  actually on before trusting file contents against these notes.

## One file, two web resources — Dev and Admin

`PR Assistant App.html` is uploaded to **both** Dataverse web resources, and
works out which one it is at load time:

```
/WebResources/admin_PRAssistant.html          -> dev    (SIDE = "dev")
/WebResources/admin_PRAssistantApp_Admin      -> admin  (SIDE = "admin")
```

(A third resource, `admin_MasterRecords.html`, serves this same file but opens
it on the Master Records page alone — see "A third web resource" below.)

Both live in the **same environment**, so the hostname is identical for the
two and cannot tell them apart. The web resource NAME — the last path segment
— is the only thing that can, which is what `resolveSide` reads. Note the
Admin resource carries **no `.html` extension** and the dev one does, so
anything keyed on the extension reads one of them wrong.

**`SIDE_BY_RESOURCE` is an explicit lookup, not a `/_admin$/` pattern, and
that is the load-bearing part.** A renamed or newly added resource that a
pattern failed to recognise would fall through to `"dev"` and write the Admin
app's rows into the dev tables. That is unrecoverable, and on screen it looks
exactly like a correct save. So an unrecognised name resolves to `null`,
`SIDE_READY` goes false, and `writeApi()` returns null for every write path
while reads carry on — a read against the wrong table shows nothing and
corrects itself, and blocking reads too would leave a reviewer staring at an
empty app with no idea why. The sidebar says `V3.0.0 · UNKNOWN` in red with a
panel naming the fix. `?side=dev` / `?side=admin` forces a side, including on
a resource whose name IS recognised, for checking the other side's wiring
from the one you have open.

### A third web resource — `admin_MasterRecords.html`, and `MODE`

There is a THIRD resource in the same environment, `admin_MasterRecords.html`,
and it serves **this same file**. It used to serve a separate one — `PR
Assistant App_MasterRecords.html`, a standalone Master Records page with its own
`<div id="root">`, its own copies of `Icon`/`Card`/`TopBar`/`PrimaryButton`, its
own `MASTER_RECORDS_PAGE_VERSION`, and its own hand-kept transcription of every
`admin_btb_lis_excel_datas` column name. That file was folded in on 2026-09-17
so there is **one script and one version number**: a reviewer on the Master
Records resource can now quote the same `V<APP_VERSION>` as everyone else, and
there is one transcription of the column names instead of two.

**What the second transcription had already cost.** The two copies disagreed
about the two Invoice columns, and `DATAVERSE_SCHEMAS` was the one that was
wrong: it carried `admin_invoicex0020x0023x0020x002fx0020dnx0020x00232` and
`admin_invoicex0020x002fx0020dnx0020date2`, neither of which exists on the
table. One unknown column fails the **whole** `$select`, so the dev side's
Master Records list came back empty with
`Could not find a property named ...` — indistinguishable on screen from
"nothing has been saved yet". The real names are the **short** ones the
standalone page used, `admin_invoicex0020x0023x0020x002` and
`admin_invoicex0020x002fx0020dnx2` (the latter read off the live column list on
2026-09-17), and the Admin side's own two are short for the same reason:
**Dataverse truncates these encoded names.** A name that reads like a complete
`x0020`-encoded label is therefore not evidence that it is one — the only proof
is the live column list.

Every column the merged page touches is now looked up through
`SCHEMA.lis.records` by the app's own field key, so there is ONE transcription
to correct instead of two to keep in step, and `writeMasterRecordFields` drops
a key this side has no column for rather than sending it — the same rule
`mapPayload` follows on the create path.

⚠️ A wrong column name does not fail small. On a READ it fails the entire
query, so every row disappears; on a WRITE it fails the entire update, so every
other field in the same Save is lost. Neither says which column was at fault
anywhere the reviewer can see it — `recordsLoadError` and `fieldSaveError` now
put the server's own message on screen for exactly this reason.

**`MODE` is a separate axis from `SIDE`, and deliberately so.** `SIDE` answers
*which tables*; `MODE` answers *which page this resource opens on*:

```
/WebResources/admin_PRAssistant.html          side dev    mode app
/WebResources/admin_PRAssistantApp_Admin      side admin  mode app
/WebResources/admin_MasterRecords.html        side dev    mode records
```

`MODE_BY_RESOURCE` / `resolveMode` mirror `SIDE_BY_RESOURCE` / `resolveSide`
(explicit lookup, lowercased name, `?mode=records` / `?mode=app` as the escape
hatch) with **one deliberate difference**: an unrecognised resource falls
through to `"app"` rather than refusing. The consequence of a miss here is the
wrong *page*, visible the instant it loads and fixed by navigating; the
consequence of a miss on `SIDE` is the wrong *table*, which is silent and
unrecoverable. The two must not be given the same failure behaviour just because
they look alike.

Any **query string is ignored** — `?preview=1` included. The resource decides,
not how the reviewer happened to open the link.

`IS_RECORDS_ONLY` is read in exactly one place: `App()` returns the Master
Records page alone, with no rail and no document viewer, **after every hook**.
An early return placed above the hooks would change the hook order between the
two modes.

The resource is also listed in `SIDE_BY_RESOURCE` as `"dev"` — that table reads
and writes the dev columns, and `null` there would give the reviewer a page that
silently refuses every write. This is **not** a softening of the "explicit
lookup, never a pattern" rule above: it is one hand-added entry for one measured
resource whose side is known, which is what the rule asks for.
`side-schema.test.js` section 1 pins the side, and `master-records.test.js` pins
the mode — both with and without the `.html`, and case-insensitively.

⚠️ `PR Assistant App_MasterRecords.html` may still be on disk. It is superseded:
nothing loads it, and editing it changes nothing a user sees. Delete it rather
than keeping a second copy of the page that can drift from this one — the
truncated column names above are what that drift looks like.

### The two schemas share nothing

`DATAVERSE_SCHEMAS` holds two verbatim transcriptions of two live schemas —
not one list with a suffix appended. The Admin side's names are **not**
uniformly `<dev name>4`: `admin_vendor`, `admin_remarks`,
`admin_contractenddate` and a dozen others carry no suffix at all, and
Quotation Start Date is `admin_startx0020date24`. Anything derived by rule
would be silently wrong for those. All five entities differ between the sides,
and `side-schema.test.js` asserts no entity name appears on both.

**Every map is keyed by the app's OWN field key, never by the other side's
column name.** That is what lets the two sides disagree about more than
spelling: the dev tables used to share ONE column between "No." and "PR No."
while the Admin tables kept them apart, so the dev `write` map simply had no
`prNo` entry — something a column-to-column translation could not express.

### The dev LIS table was rebuilt on 2026-09-18

`admin_btb_lis_excel_datas` was re-transcribed from its live column list in
"PR Assistant App - Dev". Three kinds of change at once, and only the first
looks like a rule:

- the trailing **`2`** is gone from every encoded name
  (`admin_hkd2` → `admin_hkd`, `admin_customerx0020name2` →
  `admin_customerx0020name`, and so on);
- four date columns were **renamed outright**, not de-suffixed —
  `admin_startx0020date` / `admin_odatax0020endx0020date2` became
  `admin_contractstartdate` / `admin_contractenddate`, and
  `admin_startx0020date2` / `admin_odatax0020endx0020date3` became
  `admin_quotationstartdates` / `admin_quotationenddates`. The old four were
  names a reader could mistake for each other, which is why the warning
  against pointing both pairs at one column is still in the file;
- the six **`new_`-prefixed** columns became `admin_` ones —
  `new_prstatus` / `new_flagged` / `new_statusremark` / `new_btb_type` /
  `new_quotation_expiry_date` / `new_review` are now `admin_prstatus`,
  `admin_flagged`, `admin_statusremark`, `admin_btbtype`,
  `admin_quotationexpirydate` and `admin_reviewapproval` (that last one is the
  table's own Review_Approval column, still one Text column holding both
  document names).

⚠️ `new_total_revenue` was "the one column whose logical name is the SAME on
both sides". **It no longer is** — the dev side's is `admin_totalrevenue` and
the Admin side's is still `new_total_revenue`. There is now no column the two
sides spell alike.

⚠️ Only **`lis`** was rebuilt. `agreement`, `quotation` and `atqExcel` on the
dev side keep their `2` suffix, so a sweep that strips `2` by rule breaks all
three. Two truncated names also moved by one character —
`admin_invoicex0020x0023x0020x002` → `admin_invoicex0020x0023x0020x00` and
`admin_invoicex0020x002fx0020dnx2` → `admin_invoicex0020x002fx0020dnx` — the
same trap the Master Records section already records: a name that reads like a
complete `x0020`-encoded label is not evidence that it is one.

The rebuild also gave the dev table **both** `No.` (`admin_nox002e`) and
`PR No.` (`admin_prx0020nox002e`), so `write.recordNo` and `write.prNo` are now
two keys on the dev side as well — the same shape the Admin side always had,
with none of the spelling shared. `side-schema.test.js` section 7 pins that
both sides split the pair and that the two spellings differ.

- **`PR Amount` mapping & currency actions (2026-10-05)**: on the dev side
  Verify Table, `write.prAmount` lands on `admin_pramount` (previously
  `admin_hkd`). When "Continue to save" writes the row
  (`buildLisExcelPayload`), it additionally inspects the selected currency:
  - if **HKD**: also writes `admin_hkd` with the decimal amount;
  - if **USD**: also writes `admin_usdx0020x002fx0020others` with the text amount.

`goSave`'s optimistic row preview used to name six of these columns as string
literals. It reads them through `SCHEMA.lis.write` now: a literal left behind
there blanks the freshly-saved row instead of failing, which is exactly the
silent kind of wrong this file keeps column names in one place to avoid.

Four maps per side, and they are deliberately not merged into one:

- `fields` — what the Verify Table reads back, per field key.
- `select` — what the OData query asks for. Every entry must be a column
  `fields` or `titleField` also names, or the read references a column that
  does not exist and the **whole** query fails; `side-schema.test.js` checks
  this. The Agreement's `usd` is in `fields` but not `select` on purpose —
  the column was dropped and is kept mapped for when it returns.
- `write` — what the payload builders write. Genuinely different from
  `fields`: it carries columns the Verify Table never reads back (PO No.,
  Receipt Date, Remarks, the Color Tag standing in for Status), and `fields`
  carries read-only ones.
- `records` — what Master Records lists. The `$select` **and** every
  `item.<column>` read are both derived from this one map, so they cannot
  drift apart.

`saveEntity` sits at the side's top level because the two sides point it at
different tables: the dev flow still creates a fresh `admin_purchaserequest`
row on Save, while the Admin flow finishes the LIS row that "Continue to
save" already created — so on the Admin side `saveEntity` **is** `lis.entity`.
That flow difference is pinned by an entity count (5 dev, 4 admin), so
unifying the two flows cannot happen quietly.

**`mapPayload` drops a field key this side has no column for.** Not a nicety:
Dataverse rejects the **whole** create on an unknown column, so one absent
column would otherwise lose the entire record rather than one value. It drops
`null` / `undefined` / `""` too, same as the hand-written sanitizers it
replaced — but keeps a real `0`.

### Features that exist on one side only

`FEATURES` is the one place that decides. A feature still in development on
one side is switched off for the other here, rather than by keeping two
copies of the file.

`FEATURES.btbAdminName` (Admin only) is the BTB Remark's "copy to" Admin: a
dropdown over `BTB_ADMIN_NAMES` on the Admin side, a fixed name on the dev one.
`buildBtbRemark(contact, adminName = BTB_ADMIN_NAMES[0])` takes it as an
OPTIONAL second argument whose default is the very name the dev template used
to hard-code, so the dev sentence is byte-for-byte what it always was and the
dev call sites did not change. The two labels ("Admin Name :", "Buyer Name :")
are behind the same flag as the picker, not a flag of their own: with a single
select there is nothing to tell apart, and the dev side has never labelled it.
Note the dropdown only rebuilds the sentence when a sales contact is already
chosen — `buildBtbRemark` needs a contact — so with none chosen the change is
remembered for the next selection instead of producing text now.

`FEATURES.processStatus` (Admin only) covers the LIS process-status timeline
and the `admin_processstatus4` / `admin_statusremark4` columns behind it. Two
layers guard it and both are needed: `markProcessStage` returns early on the
dev side so the timeline state never advances, and `writeLisProcessStatus`
returns early when `SCHEMA.lis.write.processStatus` is absent so nothing is
written. Hiding the timeline alone would leave the write; skipping the write
alone would leave a timeline that can never advance, which is worse than no
timeline.

⚠️ `ProcessStatusTimeline`, `PROCESS_TIMELINE_PAGES` and the `processStage`
state are **ported but never rendered** — they were never rendered in
`PR Assistant App_Admin.html` either. `PROCESS_TIMELINE_PAGES` names the five
pages the timeline was meant to sit above; wiring it up is an unfinished
feature, not a regression from the merge.

### The sidebar is three steps on Admin, five on dev

`NAV_ITEMS_ALL` holds every step either side can show; `NAV_ITEMS` is what the
rail actually draws:

```
dev    Upload · Verify Table · LIS & Remark · Master Records · Reply
admin  Upload · Verify Table · LIS & Remark
```

Master Records and Reply carry `devOnly: true` — they were taken out of the
Admin sidebar on 2026-09-07 at the user's request. Their render branches are
deliberately left in place: the pages still exist and still work, they are
simply not offered from the Admin rail.

**Filtered once, not at each call site.** `NAV_ITEMS` has three readers — the
rail's own `map`, `stepIndex`, and the progress dots — and a rail showing
three steps beside a counter reading "step 4 of 5" is the failure that
filtering in one place avoids.

**"+ New Record" stays on BOTH sides** — asked and confirmed when the rail was
cut to three. It sits directly under the rail, so hiding it alongside the two
steps that went is the easy wrong call. It is not a workflow step and is not in
`NAV_ITEMS`: it resets the record and lands on **Upload**, which the Admin
reviewer starts from as often as the dev one — and Upload is on every side's
rail, so the jump satisfies `navReachable` whatever the filter did.
`side-schema.test.js` pins both halves (not gated by side, still lands on
Upload), because nothing else would notice it going.

**`navReachable(key)` is derived from `NAV_ITEMS`, not kept as its own flag.**
The same 2026-09-07 request had a second half: `goSave` used to end with
`setPage("records")`, which on the Admin side would land the reviewer on a
page with no rail entry highlighted and no way back. So the jump is now
`if (navReachable("records")) setPage("records")` — "the sidebar hides it" and
"nothing navigates there" cannot drift apart. The write itself still happens
on both sides, and `savedRecordId` still flips the button to "Saved"; the
Admin reviewer simply stays where they are.

⚠️ `NAV_ITEMS` is filtered at module load from `IS_ADMIN`, so the side block
(`resolveSide` / `SIDE` / `IS_ADMIN` / `FEATURES`) sits **above** it in the
file — these are plain `const`s in one flat script and cannot reach forward.
Anything else that varies by side and is declared near the top has the same
constraint.

### The Admin side runs larger type

`PR Assistant App_Admin.html` had a noticeably bigger type scale than
`PR Assistant App.html` — 19px was its most common size (77 uses) against the
dev file's 13px (78 uses), and 75% of the dev file sits under 14px against
43% of the Admin one. It is read by a different audience. Basing the merged
file on the dev one dropped that, which is a regression the merge caused, not
a pre-existing difference.

**The scale is per ELEMENT, not per size.** The same dev 13px is 13, 16 **or**
19 on the Admin side depending on what it labels; 12px splits five ways. So a
`13 -> 16` lookup would be wrong about half the time, and there is no
multiplier that reproduces it either.

So each size that actually differs carries a token class whose **name states
both values**:

```css
.fs-13-19 { font-size: 13px; }
[data-side="admin"] .fs-13-19 { font-size: 19px; }
```

23 tokens, 116 elements, plus two `fsc-*` tokens for the sizes written as
`clamp()` — those carry their own prefix because their values are not a px pair
and a `fs-<dev>-<admin>` name could not state them, so their names are not
self-checking the way the others' are. Sizes that are the same on both sides
keep their plain Tailwind `text-[Npx]` and have no token. `data-side` is
stamped on `<html>` (not the App's own wrapper, so it also covers anything
rendered outside that tree) and falls back to `"dev"` when the web resource
was not recognised: the app still has to be readable while it is refusing to
write.

How the mapping was derived, and how to extend it: a dev line and an Admin
line pair when they are identical once every size is blanked out. Skeletons
whose Admin counterparts disagree among themselves are resolved by the markup
around each occurrence — **not** by position, since the Admin file has extra
occurrences interleaved — and are pinned by hand in the test's `AMBIGUOUS`.

⚠️ **A size can be written three ways, and the first sweep understood only
one.** `text-[13px]`, Tailwind's named `text-xs`, and `text-[clamp(a,b,c)]` are
all sizes. The original pairing matched only the bracket-px form, so every
element carrying the other two was silently counted as "no counterpart" instead
of compared — and 5 of them were left at the dev size on Admin while the check
reported zero disagreements. **`leading-` is the same trap one level down**:
the Admin file scales line-height too (`leading-[18px]` → `leading-[21px]`), so
a line whose leading also changed never paired and its font size was never
looked at — that hid 15 more. Both are now normalised out before pairing, and
`AMBIGUOUS` is looked up on a STRICTER skeleton that keeps `leading-`, because
it is an ordinal table and the looser skeleton merges groups and shifts every
index.

⚠️ **A token must never sit beside a Tailwind size class on the same
element.** Tailwind's stylesheet is injected after this one, so `text-xs`
would win and the token would do nothing, silently.
`side-schema.test.js` checks for that, and also that every token's two rules
say what its name says, that the Admin value is always the larger of the two,
and that no rule is orphaned in either direction.

**The Admin side is held to the original file, element by element.**
`side-schema.test.js`' section 12 renders every token at its Admin value and
compares every element against `PR Assistant App_Admin.html`; 0 may differ.
It is the only check that can say the Admin VALUES are right rather than merely
self-consistent, so it runs while that file is still on disk and SKIPS (does not
fail) once it is deleted.

The workflow rail's step label was briefly raised to 16px on Admin and is back
at 15px: it is 15px in BOTH originals, and parity with `App_Admin.html` wins
over a round number. (`fs-15-16` exists again, for two other elements that
really do measure 15 → 16.)

14 elements cannot be paired automatically, the count is pinned, and **each was
resolved by hand** rather than left alone: the unrecognised-resource warning
(`fs-10-13`, which this merge invented and so had nothing to measure against);
"Total attachments: N", which `App_Admin.html` has no line for; four chips in
the document rail, which `App_Admin.html` sizes through a `large ?` ternary
whose non-large arm already equals the dev size; and eight whose Admin twin
differs in some other class (a border colour, a `leading-`, a template
literal) — each read off `App_Admin.html` directly. An element the check cannot
pair is **not** evidence that it has no counterpart; go and look.

### What the merge did NOT do

The two files had each moved ahead of the other, and only the Dataverse layer
was unified. Still Admin-only, still only in `PR Assistant App_Admin.html`:
the Status Remark UI and "Save & Return",
`LIS_ROW_TO_FIELD_KEY`, `NO_ATQ_VALUE_ROW_IDS` and the Quotation Expire Date
row, and the `issueBy` / `chargeCcc` / `accountCode` inputs on LIS & Remark.
Each needs its own call about whether the dev side should have it at all —
Quotation Expire Date, for instance, would always be blank there, since only
the Admin quotation table has `new_quotation_expire_date`.

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

The user then reviews the three role slots (Agreement / ATQ / Quotation) and
clicks **Process**, which calls
`DocparseEngine.resumeDeferredOcr(prevResult, wantedDocIndexes, onStatus, opts)`
only for the documents that actually landed in a role slot — attachments nobody
assigned a role to are never OCR'd at all. `resumeDeferredOcr` re-runs
`parseByExt` per document (not a page-splice), reusing `seedMarks` so the ink
pass is not repeated. Only after Process succeeds does OCR content land in the
form fields (`detectFromRoles`, called from `goProcess`, guarded by each field's
own `auto === false` so a manual edit is never overwritten).

**A `parseFile` that OCRs eagerly must pass `ocrBudgetMs`.** The engine's two
budget-setting call sites are both on the container path — an email's attachment,
and `resumeDeferredOcr`'s per-document re-parse — so a file handed straight to
`parseFile` used to get no soft deadline *and* no hard timeout. Measured:
`L260390185MZ signed contract.pdf` (22 scanned pages) ran 500s to completion, past
`ATTACHMENT_OCR_BUDGET_MS`, with no cut-off note, because there was nothing to cut
it off. Two App call sites are on that path and both OCR eagerly: `goProcess`'s
`entry.fileObj` fallback (for a document with no retained raw result) and
`handleAddDocument`. Both now pass `ocrBudgetMs: DocparseEngine.OCR_BUDGET_MS`.

It is an **opt, defaulting to unbounded**, not a new default — `Docparse/index.html`
calls `parseFile` with two arguments and a deadline would change its output for
exactly this document. Which behaviour is better genuinely differs by consumer: a
human who dropped one file and is watching the status line wants all 22 pages,
while a Process click waiting on four documents cannot spend eight minutes on one
and leave the other three unread. `ab-diff` cannot see any of this (text-layer
only), so the check is the browser: with `ocrBudgetMs: 1` the same file returns in
173ms carrying `truncated: true` and
`[Pages 1-22 not read — time limit reached]`.

**Anti-pattern: do not run OCR eagerly on upload again.** The whole point of
`deferOcr` is that OCR only happens for documents a human has already assigned a
role to. If you find yourself wanting to trigger OCR before Process is clicked,
that is very likely the wrong fix — the role slots exist precisely so OCR is not
wasted on the other attachments of the email.

## The role editor's selects name documents — there is no "Auto" row

`RoleAssignmentEditor` opens each role's `<select>` on the document that role is
actually reading from: the override if the reviewer pinned one, otherwise the
document `autoCensus` detected. The old `Auto — <file>` row is gone. It named the
same file the list below it already named, under a **second value** (`""`) that
meant something different, so the picker offered one document twice and only one
of the two was stored on Save.

Three things this depends on, and the first two fail silently:

- **A `<select>` whose value matches no `<option>` renders showing the FIRST
  option.** So a role with nothing detected keeps an explicit
  `<option value="">Nothing detected</option>`; without it an undetected
  Agreement slot displays the quotation as though a reviewer had chosen it.
- **`changed` compares against the draft the editor OPENED with, not against
  `census.overrides`.** A role prefilled from auto-detection differs from `""`
  on the very first render, so comparing to the overrides reports "Unsaved"
  before the reviewer touches anything. `initial` is its own `useState`
  initialiser for exactly this.
- The three preselections are pinned in `render.test.js` by reading
  `selected=""` off the rendered options, not by re-deriving them from the
  census the component was handed — re-deriving would pass however the select
  actually rendered.

**The cost, accepted deliberately:** saving from the editor now pins *every*
role, because each select carries a document key rather than the `""` that
`saveRoles` reads as "no override". A reviewer who opens the editor and saves has
frozen all three slots to today's answer; new attachments will not be
auto-reassigned into them. Only a role with nothing detected still saves as `""`
and keeps following the documents.

## Customer PO was removed, on purpose — do not re-add it

There is no `po` role and no "Customer PO" attachment type. Both were deleted
outright at the user's request, not hidden behind a flag, so the product has
**three** `DOC_ROLES` (Agreement / ATQ / Quotation) and **four**
`ATTACHMENT_TYPES` (Vendor Quotation / Contract / ATQ / Excel).

What went with it, so a partial restore does not leave a half-wired role:

- `DOC_ROLES`' `po` entry, its filename/heading patterns, and its `optional: true`.
  **No role carries `optional` any more**, so every `role.optional` branch was
  deleted too — the "optional — none here" slot label, the "it is optional, so
  nothing is checked against it" `why`, the compare panel's absent-slot text, and
  the "optional, not in this upload" arm of Verify's *Not cross-checked* line.
  Re-adding a role without restoring those leaves an optional document reading
  as a **missing** one, which is the opposite of what its absence means.
- `"po"` from `ROLE_MATCH_ORDER` and from `REFERENCE_ORDER`.
- `ATTACHMENT_TYPES`, `ATTACHMENT_FIELD_SCOPE` and `ATTACHMENT_STATUS_ROWS`'
  `"Customer PO"` entries, and the `PO-88421.pdf` demo attachment.
- Verify's gate no longer filters the type list: `attachmentsOk` now requires
  **every** `ATTACHMENT_TYPES` member, the count reads
  `${parsedCount}/${ATTACHMENT_TYPES.length}` rather than a hard-coded `/5`, and
  the "Customer PO not included, which is fine" note is gone. The manual
  checklist says "All 4 attachment types".

Two consequences worth knowing before reading a demo run:

- **The demo's `hkd` conflict is now 1-against-1.** It used to be the ATQ + the
  workbook + the PO on 128,400 against the quotation's 132,800; the PO's
  corroboration is gone, so `cc.hkd.clusters[0].roleKeys` is `['atq']`. The amber
  still appears and `crosscheckDissent` still opens the quotation — the verdict
  did not change, only how many witnesses stand behind it.
- **`customerName` pairs are C(3,2) = 3, not C(4,2) = 6.** Any test asserting a
  pair count is counting roles, so it moves whenever `DOC_ROLES` does.

`ROLE_DETECT_ORDER` is unchanged (`atq`, `agreement`, `quotation`) — the PO never
filled the form, so removing it moved no value on the page.

## `entry.parsed` — do not change its meaning

`entry.parsed` (on each of the four attachment-type entries in `attachments`)
means "a file was dropped and read", **not** "OCR has finished". Roughly eight
places in `PR Assistant App.html` gate on this flag assuming that meaning; it
stays `true` after a light-pass upload, before Process ever runs. Whether OCR is
still outstanding is tracked separately via `entry.phase` (`"light"` | `"full"`)
and `entry.pendingDocs`. If you need to know "has this attachment finished OCR",
check `phase`/`pendingDocs`, not `parsed`.

## The email subject is a witness, and it says which item

A PR request's subject states, in one string, five things no single attachment
does:

    2_NON-BTB PR REQUEST (Item 10) - NEW CHARM MANAGEMENT LTD - (UID-26-04-0143-10)[Type-Logger - HP - Chu, Patrick WK(10-Nice Systems BV)]
    ^^^^^^^                          ^^^^^^^^^^^^^^^^^^^^^^^     ^^^^^^^^^^^^^^^^^ ^^^^^^                                ^^ ^^^^^^^^^^^^^^
    back-to-back                     customer                    uid               product type                         item  vendor

`parseEmailSubject` reads all of it. **Nothing it returns fills the form.**
Procurement sends ONE email per item, so what the subject has authority over is
*which item this email is about* — `itemIndexForSubject` picks the tab that
opens — while every value stays the Cost worksheet's. What it buys is a second,
independent witness: on the one email measured end to end it backs the Cost
sheet's per-item `Vendor / Distributor` ("Nice Systems BV") against the ATQ
sheet's container-level `Vendor` ("Ingram,Tech Data,AEM"), and the workbook's
Back-to-Back `N` against the PDF print's `Y`.

**The item number is the trailing bracket, not the UID's tail and not
"(Item N)".** All three appear and only the bracket appears every time: one real
subject carries `UID-26-04-0045-2` and `(3-DCSS Technology (Hong Kong) Limited)`
at once, another carries `UID-26-06-0037` with `(1-Cisco)`, and `(Item N)` is
printed on roughly half. The UID's tail agrees often enough to look like a rule
and is not one. `itemIndexForSubject` falls back to item 0 rather than to a near
miss — landing on the wrong item is worse than landing on the first, because
every value on the page then belongs to something nobody asked about and nothing
says so.

**`(Item 2 & 3)` and `(2-NEXUS2S)` answer different questions.** The printed
marker is a LIST — which items of the Cost worksheet the whole PR request
covers, `itemsCovered` — and the trailing bracket is the single item THIS email
is for, `itemNo`. The same `(Item 2 & 3)` is printed on both of item 2's and
item 3's mail; only the tail differs. The old single-number pattern read neither
on that shape, because it required the `)` to follow one number immediately, so
the marker was silently absent rather than wrong. A list of MORE than one is
deliberately not allowed to stand in for the tail (`itemNoPrinted` stays `""`),
for the same reason `itemIndexForSubject` refuses a near miss.

**Product type is read twice, on purpose.** `productType` stops at the spaced
dash — "UCBV AV Equipment" — and is what the cross-check compares against a
document's Product Type. `productTypeRaw` is the whole square bracket,
"Type-UCBV AV Equipment - Chang, Kelvin KW; Lam, Kelvin CK", cut at the trailing
`(N-Vendor)` opener and for display only. Comparing the raw one would report a
standing conflict against every document that ever states a product type, since
no document prints the requestors' names glued onto it. Note the raw reading
carries real people's names; test fixtures substitute them.

Four things the parser cannot be simplified past, each measured:

- **Brackets nest, and two different kinds of bracket are in play.** A vendor
  writes `(3-DCSS Technology (Hong Kong) Limited)` and a customer is called
  `FUBON BANK (HONG KONG) LIMITED`. The `(digits-` opener tells the item bracket
  from the customer's; a balanced walk tells its closer from the vendor's own.
  The real `.msg` subject also wraps everything after the UID in **square**
  brackets, which the saved file name does not.
- **`\b` is the wrong boundary for BTB.** `2_NON-BTB` glues NON to an
  underscore, which IS a word character, so `\bNON` never matches while `\bBTB`
  does — the subject that says NON-BTB loudest is exactly the one `\b` reads as
  back-to-back.
- **The `Type-` separator is bare, its terminator is spaced.** `Type-Logger` is
  glued and ` - ` is spaced, so a class that stopped at any dash reports `Wi` for
  `Type-Wi-Fi`. `subjectCustomer` splits on the spaced dash for the same reason:
  `PCCW-HKT Limited` is one token.
- **Read the `Subject:` LINE, not the whole text.** A forwarded thread quotes an
  older request's UID in the body. Matching the first hit anywhere only lands on
  the right one because `processMsg` prints the header first — luck, not a rule.
  (This still governs everything the subject reports. The **UID alone** was
  moved off it on 2026-09-25 — see below.)
- **A UID suffix can be LOWERCASE, and that is not the same as widening the
  class.** `UID_PATTERN`'s suffix was uppercase-only, so
  `G260690247TS_WIFI_(UID-26-06-0151-1b)` reported `UID-26-06-0151` — the
  character that tells this request from its `-1a` sibling, dropped silently.
  The uppercase rule still earns its keep, though: with `[A-Za-z]{0,3}` a
  forwarded body's `UID-26-07-0126and approved` becomes `UID-26-07-0126AND`, and
  with a bare one-character cap it becomes `UID-26-07-0126A` — a wrong UID, which
  is worse than a short one. So the suffix is two alternatives,
  `[A-Z]{1,3}` **or** `[a-z](?![A-Za-z])`: one lowercase letter, and only when no
  letter follows it. `and` is rejected for the `n`; `-1b)` is taken because `)`
  is not a letter. All three wrong shapes are pinned in `email-subject.test.js`.
- **The printed case is kept.** `normaliseUid` uppercases only the `UID` prefix,
  where the old code uppercased the whole match. That was harmless while every
  matchable suffix was already uppercase; now it would hand back
  `UID-26-06-0151-1B`, every character present but not the value the email
  prints. Cross-checks are unaffected — `uid` compares through `normRef`, which
  strips to `[A-Z0-9]` first.

### The UID comes from the BODY, not the subject (2026-09-25)

Asked for directly, and it is a **reversal** of the rule above rather than an
extension of it. `uidFromEmail` now has three tiers in this order:

1. the email **body** — `uidFromEmailBody`, i.e. `extractUid(emailBodyTextOf(…))`
   over every attachment tab;
2. the **subject**, exactly as before (`emailSubjectOf`, which still falls back
   to the dropped file's own name);
3. the **form field**, the floor for a manually-created or non-email upload.

The subject is kept as tier 2 deliberately: an email whose body prints no UID
behaves exactly as it did before, instead of losing the value altogether. Tier 2
still reads the Subject header, then the dropped file's own **name** (a `.msg`
saved to disk is named after its subject) — and those two are deliberately not
symmetrical: a real header counts even with no UID in it, a file name only
counts when it carries one, or every loose `quotation.pdf` would present itself
as this email's subject.

**`emailBodyTextOf` is what makes "the body" a real thing**, and the old code had
no equivalent: `applyUid` scanned the WHOLE `plainText`, and since the engine
prints `Subject:` at the very top, the subject won **by position** rather than by
any rule. Three things it does, each needed:

- cuts the header block — everything from the `Subject:` line down to the first
  blank line after it;
- stops at the next `=== … ===` marker, so an attachment's text is not the body;
- stops at the thread this mail is REPLYING to (`QUOTED_THREAD_LINE`: a `>`
  prefix, or an unprefixed `-----Original Message-----`).

⚠️ That last one is not a second rule about which UID to pick — the first UID in
the body still wins, which is what was asked. It is part of what *the body* means.
A forwarded request quotes an older one's subject line, UID and all, and
`n8n-send.test.js` already pinned the measured case: without the boundary the
mail reports `UID-20-99-9999-1` while its own header says `UID-20-03-0003-4` — a
wrong UID that looks entirely right on screen. The risk is not eliminated, only
bounded: a quoted thread that carries **no** quote marker is still reachable.

⚠️ **Text carrying no `Subject:` header is returned WHOLE.** A quotation PDF
dropped on a tab is not an email and has no header to cut; returning `""` for it
would silently stop `applyUid` reading a UID off a document it has always read
one off.

`detectFromRoles` follows the same body-then-subject order, and asks the two
tiers rather than `uidFromEmail` itself — that function's third tier is the form
field, so calling it there would overwrite the value with the value.

The subject is **not** wired into `computeFieldDiffs` as a fifth source, and
should not be. That machine resolves every source through `roleOfSource` /
`roleCensus` down to one of `DOC_ROLES`, a file and a page — the Role Slot Bar
and the viewer's "open the dissenting document" link both depend on it. A
subject line is not a document anyone can open. `EXTRACTED_EMAIL_COLUMN` is a
fifth *column* instead, graded by `subjectVerdict` using the cross-check's own
rules so the two surfaces cannot disagree about what "the same" means. Agreement
with ANY document is agreement: which files disagree among themselves is already
the row's own amber, and colouring this column too reports one disagreement as
two.

## The Verify Table's header document button opens the column's OWN document

Each document column's header carries a file icon that opens the one document
its cells were read from (`columnDocSource`, beside `roleCellValue` on purpose).
It uses **roleCellValue's resolution, not `census.assigned` alone**, and the ATQ
is why: that role holds two documents — the PDF print and the workbook behind it
— `census.assigned.atq` picks the **PDF**, and the column is **ATQ (Excel)**. A
header wired to `assigned` would open the PDF while every cell beneath it was
read from the `.xlsx`, which is worse than no button: it invites a reviewer to
check a number against a document that does not contain it. A column that states
a `kind` therefore re-picks within its role by the same pdf/not-pdf test
`roleCellValue` splits its values on, **and the search stays inside that role** —
on the shipped demo every other document happens to be a PDF, so dropping the
role filter still lands on the workbook by luck, and a fixture with a non-PDF
under another role is what tells the two apart.

Two conditions withhold the button, each removing one that would lie: no
`openViewer`; and no `blob` (the viewer would show an empty preview — the same
rule the Company Chop row's **View** link follows). Dataverse mode does
**not** withhold it — a reviewer comparing a Dataverse value against the
document behind it is exactly who wants this button most, and the button was
briefly withheld there before a real screenshot showed a reviewer unable to
open the Agreement or Quotation at all while a `DATAVERSE` badge sat right
next to the greyed-out icon. What Dataverse mode changes instead is the
tooltip: it stops claiming to be "the document this column is reading from"
(false once the cells below answer from Dataverse) and says instead that the
button opens the document *behind this role*, while the cells answer from
Dataverse, not from it. The ATQ column's tooltip is unaffected, since
Dataverse does not answer for it at all.

**It opens the viewer on that document alone** — `openViewer(typeKey, docIndex,
page, only)`, where `only` narrows the picker to the one document. Optional and
defaulting to the old behaviour, exactly like `page`: this is the *only* call
site that passes it, and `render.test.js` asserts that. A chip, a field row or
the chop **View** link genuinely wants the whole pile, because the reviewer is
browsing from there; a column header is the opposite case, since the column
beneath it answers from one file and offering the siblings invites checking a
number against a document that never reported it.

Two things inside `DocumentViewer` this depends on:

- **The narrowing falls back to the whole list** when `docIndex` names nothing
  in the entry. Narrowing to `[]` would leave a picker with no rows beside a
  preview that still resolved through `selfDoc`.
- **The email body follows the same switch** (`sidebarSelfDoc`), keyed on
  whether the narrowing actually happened rather than on `viewer.only` — keyed
  on the flag it produced "all three documents, no email body", a half-state
  neither branch means. Caught by a mutation, not by review.

Testing note: the fixture needs `entry.self` and a `pages[0].lines` so
`selfDocFor` returns a body. Without one the viewer resolves a stray index to
nothing and renders nothing at all, and the stray-index assertion compares two
empty strings and passes however the narrowing behaves.

## The Quotation slot is per item, and the engine already decided it

An ATQ covering "Item 2 & 3" carries one vendor quotation per item. The engine's
`matchQuotationAttachments` resolves each record's quotation reference against
the email's other attachments and leaves the answer on `record.quotationFiles`;
`offItemQuotationTest` in `PR Assistant App.html` is the only reader of it. It
returns a `(typeKey, fileName) => bool` test that both `computeFieldDiffs` and
`roleCensus` stamp onto every source as `source.offItem`, and
`autoRoleOfSource` then declines the Quotation role to a document the anchored
item does not name.

Three rules this depends on, all easy to break:
- The test is scoped to the container that holds the records
  (`recordsBearingTypeKey`). A quotation dropped on its own tab was never a
  candidate for `quotationFiles` and must never be ruled out for being absent
  from it.
- No `quotationFiles` falls back to the item's **vendor**, and that fallback only
  ever rules a document OUT. The form's QUOTATION column is optional and often
  blank — `ATQ-202603-00386-V23` leaves it empty in both its PDF and its
  workbook, so the engine had no reference to resolve, every item was offered the
  email's one DCSS quotation, and item 1 took it while item 2 (the DCSS item)
  showed none. The item still names who it bought from, and the quotation names
  its own issuer, so a quotation whose vendor disagrees with the anchored item's
  `Vendor / Distributor` is declined (compared through `vendorsAgree`, i.e. the
  same fuzzy rule the cross-check uses, since `vendor` is a `FUZZY_DIFF_KEYS`
  member). It never rules one *in*, and an item that names no vendor or a
  quotation whose vendor cannot be read still means *no filtering at all* — a
  wrong exclusion would hide the only quotation the email has. This is also why
  reading a quotation's vendor out of its sign-off block matters twice over: it
  is what makes the fallback work at all.
- A ruled-out document keeps its place in `roleCensus`' `docs` pool and stays
  assignable by hand; an explicit override still wins, because `roleOfSource`
  checks overrides before it ever asks `autoRoleOfSource`.

`goProcess` deliberately does **not** reuse the on-screen `census` for its OCR
targets — it crosses every override set with every item index, or the other
item's quotation would never be OCR'd.

## Field labels: the ATQ's vocabulary is not the vendor's

`FIELD_LABEL_MAP` has to speak three dialects. The ATQ prints "Quotation", "Total
Value of Quotation (HKD)", "Vendor / Distributor"; a vendor's own quotation
prints "Quotation No." / "Quote No.", "Total Amount (HK$)" / "Sub-Total" /
"Project Total", and names itself under "On Behalf of"; a **scanned agreement**
prints "OCBC Contract Reference No" and "Maintenance Period: 1 Apr 2026 - 31 Mar
2027". Adding a pattern for one must not widen it into the other's ground — the
amount patterns are anchored at both ends and allow only a currency marker after
the word, so "Total Qty" stays out.

We are the middle party on these emails — a vendor quotes to HKT, HKT contracts
to the end customer — so a quotation carries **three** company names, and the one
it labels most plainly is us: DCSS's prints `Company Name: HKT Limited` for the
buyer and `End user: OCBC` for the customer. `customerName` therefore learns
"End user" and deliberately does **not** learn "Company Name". Our own name is
*not* rejected from this row, and that is the same call as `markIsOurs` and
`ourCompanyOnlyDissent`: `Client: HKT` on Xtreme Lighting's quotation is a true
answer to the label the vendor printed, so the value stays and only the severity
of the disagreement drops. Two tests pin that choice
(`quotation-fields.test.js`'s `"Client" still reads as the customer` and
`crosscheck.test.js`'s `softened, not a conflict`) — turning it into a filter
breaks both, on purpose.

**A value that is itself a column header is not a value** (`HEADER_CELL_VALUE`,
dropped before either pass and before the period pass). A two-column table's
header row pairs into a label:value for any reader that walks label-then-value,
and the signed agreement has two: `Customer | Project` and
`Start Date | End Date`, which filled Customer Name with "Project" and Start Date
with "End Date". A wrong value is worse here than a missing one — the row looks
answered and raises no conflict. The vocabulary is the app's own label words on
purpose, so it grows with `FIELD_LABEL_MAP` instead of drifting into an arbitrary
denylist; it is anchored whole, so "Total Sports Limited" is untouched; and
"Service"/"Product" are deliberately absent because they are plausible whole
values for Service Type and Product Type.

`FIELD_LABEL_FALLBACKS` is the *ambiguous* reading of a label, so it never sees a
label `FIELD_LABEL_MAP` already claimed (that is what the `claimed` set in
`mapDetectedFields` is for). This is why "Quotation No." no longer also fills
Contract No.: it is a quotation number, and filling both rows raised a Contract
No. conflict against the ATQ's real agreement number. Fallback entries may carry
a `reject` predicate for a value the pattern matched but the key cannot hold —
`To` also being an email header is the case it exists for.

`quotationRefFromText` reads a quotation number out of `doc.textBlock` when no
label reported one: some quotations print their header as a block of labels over
a block of values, which the engine's label:value pairing cannot join. It is
done App-side on purpose — fixing it in the engine would move
`Docparse/index.html`'s two-argument output, which must stay byte-identical.

`contractNoFromText` is the third, and the ATQ's own agreement number is what it
recovers. The engine's line pass reads the row correctly —

    "Agreement Number   L260390185MZ   Previous Agreement Number   L250300109KW"

— but it is a `para` block holding FOUR columns, label/value/label/value, and the
paragraph field reader pairs a line's label with one value, not two. So the ATQ
(PDF) column reported no contract number at all and only the workbook had one: a
reviewer comparing the two saw one side blank rather than the two sides agreeing.
It splits the line on runs of two-or-more spaces, because those runs ARE the
column boundaries, and matches each cell **whole** — which is the part that
matters, since "Previous Agreement Number" sits two cells from the right answer
with an equally valid-looking reference (`L250300109KW`) beside it. Anchoring per
cell is what keeps them apart; a regex over the whole line would not.

`hkdTotalFromText` is the fourth of these, for the amount. DCSS's quotation puts
"Grand Total" and its figure at opposite ends of a table row, so the engine pairs
neither with the other and reports the figure as its own label
(`"HKD 1,755" => "HKD 1,755"`) while "Grand Total" never becomes a label at all.
The line `Grand Total HKD 1,755` is plainly in the text, so it is read back out of
it. **The currency has to be stated**, and that is what makes guessing from free
text safe enough: the row is HKD, so the line must say HKD or HK$ before its
number is taken, and the same page's `Price (HKD) HKD 2,340` unit price cannot
slip in because the line must begin with a Total. (`usdOthers` has no equivalent
yet — it is not in `FIELD_LABEL_MAP` or `ATTACHMENT_FIELD_SCOPE` at all, so a USD
quotation still needs that groundwork first.)

`vendorFromText` is the same idea for the vendor, and the only outright *guess*
in the field mapping: it reads the company standing under a quotation's sign-off
("For and on behalf of", or a letter's "Yours Sincerely", → the next
company-shaped line, with a leading `for ` stripped: DCSS's letter prints
`for DCSS Technology (Hong Kong) Ltd`, and a name left with the "for" glued on
matches nothing the ATQ says). Three things bound it, and removing any one of them
makes it wrong rather than merely wider:

- **Exactly one sign-off block, or it stays silent.** A contract is signed by
  both parties and prints the phrase twice; picking the first would name the
  customer as the vendor about half the time.
- The candidate must look like a company (a legal-form word, or two capitalised
  words) and must not be sign-off furniture — `VENDOR_SIGNOFF_SKIP` lists the
  boilerplate that shares that block.
- It runs only when no label answered, and the value is cross-checked like any
  other, so the ATQ still gets to contradict it.

It can legitimately land on **us**: a quotation HKT issued is signed by HKT.
That is why `OUR_FULL_NAMES` exists — `normName` reduces "Hong Kong
Telecommunications (HKT) Limited" to "HONG KONG TELECOMMUNICATIONS", three
tokens `OUR_CORE_NAMES` cannot see, so without it the `ourCompanyOnlyDissent`
softening never fired and a real corpus email (`e0`) grew a false vendor
conflict. Do not turn that softening into a filter: HKT genuinely is the vendor
on some ATQ items, so the value stays and only the severity drops.

## Whose chop is it — read the sign-off block, not the chop

A signed page carries BOTH parties' ink. On `Demo Data/chop/Maintenance Service
Agreement (Customer signed).pdf` HKT signs and chops on the left while the
customer chops on the right, so "is this chopped" has two answers and only one
of them is the one a reviewer is asking about.

**The chop's own wording does not answer it.** Measured across all four
documents in `Demo Data/chop/`, `readChopText` returned `"0"`, `null`,
`"One Center"` and `"lons (HK1) Limited 6"`. The chops are round: the name runs
around the ring and a line-based recognizer reads an arc as nothing. The one
result that looked like a company name — `"on ehalf A uthority-WHSI"` — was the
PRINTED sign-off line caught inside `readChopText`'s own 15% padding. Do not
build anything on `mark.text`; `markOwnerName` in the App deliberately refuses
to fall back to it.

What is legible is the printed block above the ink, one party per column, and
that is what `attachMarkContext` reads into `mark.context = {name, cue, label}`.
It is also the ONLY thing that works for a signature — handwriting carries no
company name at all.

Two hard constraints on it:

- **Opt-in (`markContext: true`).** `pages` is part of `parseFile`'s result, so
  a mark growing a `context` property is a visible output change and
  `Docparse/index.html`'s two-argument call must not see one. All four App call
  sites pass it; nothing else does.
- **"Ours" softens, it never filters.** `markIsOurs` sets our own ink aside —
  greyed pill, a greyed line of its own under Company Chop — but the mark stays
  in `signing.marks` and stays on screen. Extracted Fields' Company Chop row
  draws one line per mark (`markDetections`, not a summary sentence): name,
  page, ink colour, the detector's own confidence, and a **View** link that
  opens the agreement at that mark's page via `openViewer(typeKey, docIndex,
  page)` — `page` is optional and every other call site omits it. A mark whose
  sign-off block was unreadable keeps its line and says "Owner not identified";
  `signatureDetectionLabel`'s one-line summary survives only as the fallback
  for a signing result that carries no `marks` at all. Same reasoning as `ourCompanyOnlyDissent`
  above: a wrong exclusion deletes the evidence silently, a wrong inclusion is
  on screen to be argued with.

## The chop's own picture — the crop is a COLUMN, not a padded mark

A reviewer asking about a chop wants to look at one 2cm ring, and opening a
22-page scanned contract to find it is what `markCropRect` replaces. It is
opt-in (`markCrop: true`, all four App call sites; `Docparse/index.html`'s
two-argument call must never see a `crop` property, same rule as `markContext`),
runs in the **eager ink pass** so the picture exists before Process is clicked,
and stamps a JPEG data URL on `mark.crop`. `markDetections` carries it to the
Company Chop row, which draws it as a thumbnail; clicking enlarges the crop
in place rather than opening the document. The **View →** link stays beside
it for anyone who does want the page.

**The crop must carry the printed sign-off block, and that decides its width.**
The ink never says whose it is — `readChopText` returned `"0"`, `null`,
`"One Center"` and `"lons (HK1) Limited 6"` across all four documents in
`Demo Data/chop/` — so a picture of the seal alone shows the reviewer the one
part of the page that cannot be checked. So the rect is the **union of the mark
and the lines `mark.context` was read from** (`context.box`, added by
`signOffContextFor`), not a padding factor on the mark. Measured on the
two-column page:

    HKT chop      x 0.321..0.431      its name line   x 0.100..0.414
    customer chop x 0.626..0.752

The name begins **0.221 of the page LEFT of the chop that owns it**, so a
symmetric pad wide enough to reach it runs to 0.662 and takes in the
counterparty's seal — turning the "whose is this" answer back into the
two-answer question it started as. The union lands at x 0.08..0.451, clear of
0.626 by a third of the page.

Two things this depends on:

- **`unionBox` reads BOTH box shapes.** `boxesToLines` emits `{x, right, y, h}`
  while mark bboxes emit `{x, w, y, h}`. Reading only `w` makes every bound NaN
  for a line, which JSON prints as `null` and `markCropRect` then treats as "no
  context" — a silent fall back to the blind rect that looks exactly like a mark
  whose owner was never found.
- **No context means no guess at the column.** The fallback reaches up by
  `CONTEXT_MAX_ABOVE` and widens only to twice the mark. Guessing a column width
  there would show the other party's block under this mark's name.

`markCropRect` is exported and pinned in `chop-owner.test.js` against the same
measured fixtures, because whether the rect reaches the name and stops short of
the other column is exactly what a browser eyeball cannot check reliably — a
wrong column looks identical to a right one. `ab-diff` is **structurally blind**
to all of it: `ab-dump.js` never calls `parseFile` and never touches marks, so a
clean run there proves nothing about this. The picture's own quality is
browser-only.

Three thresholds in the engine are calibrated against real pages, and each one
was wrong in the obvious direction first:

- `boxesToLines` **splits a line at wide horizontal gaps**. A two-column
  sign-off puts both parties on the same baseline, and joined into one line it
  spans the page — which is exactly how the left party's name ends up owning
  the right party's chop.
- `standsAbove` measures against the mark's **middle**, not its top. A chop is
  routinely stamped so it laps over the name above it; the customer's seal here
  overlaps by a third of its own height.
- `cueAbove` allows a small **negative** gap. OCR boxes are drawn generously and
  the cue's box ends 0.001 of a page BELOW the top of the name it introduces.

`repairBrackets` (App) is the same class of problem at the other end: OCR
returned `"Hong Kong Telecommunications (HKT Limited"` with the closing bracket
gone, and `normName` only strips a *balanced* parenthetical — so `"(HKT"` stays
glued together and never matches the core name. Repaired at this feature's own
boundary rather than inside `normName`, which every cross-check in the app
normalises through.

## One ATQ, two attachments, two REVISIONS

`dedupeAtqRecords` groups records by the ATQ's **identity** — the reference with
the trailing `-V##` cut off — not by the whole reference. Measured: one email
carries `ATQ-202607-00201-V01.xlsx` beside
`ATQ-202607-00201-V022026-08-20T12_10_22.pdf`. Grouping on the whole reference
put them in two groups, the group holding the print had no workbook in it, its
`if (!group.some(isWorkbookRecord)) return;` guard fired, and **nothing was
dropped**: a one-item ATQ offered thirteen items for selection, two of them
labelled "Item 1". The workbook's Cost sheet really is `A1:K2` — one header row
and one data row — so the print's twelve are the whole form, not this
requisition's items.

**Within a group the workbook still wins, and among workbooks the latest
revision wins. A newer PRINT does not beat the workbook.** The item list a
requisition covers comes from the Cost worksheet, which is the entire reason the
workbook is preferred; letting a newer print supply the list would put back the
twelve items nobody asked for. `parseAtqWorkbook` reads `wb.Sheets['Cost']` and
nothing else, so "only the Cost worksheet's items are offered" needs no separate
filter — it follows from the print's copies being dropped.

**`supersededBy` is why this is not a two-line key change.** On the measured
email the workbook is the OLDER one (V01), so the kept values are the ones V02
was issued to change. Dropping the print silently would turn a visible duplicate
into an invisible wrong number, which is the trade this codebase refuses
everywhere else (`markIsOurs`, `ourCompanyOnlyDissent`, the quotation vendor
fallback). So a kept record whose group held a higher revision it did not come
from is stamped with that revision, and `supersededRevisionOf` draws an amber
line beside the item selector naming both. **Nothing is chosen for the reviewer;
they are told the choice exists.**

Two details that look arbitrary and are not:

- **`atqRevisionOf` answers `-1`, not `0`, for a reference with no revision.** A
  real `V00` would otherwise be indistinguishable from "does not say", and the
  two want opposite answers when the newest is being picked.
- **`ATQ_REVISION` is anchored at the END** (`/-V(\d+)$/i`). A reference
  carrying no revision keeps its whole self as the identity rather than losing a
  chunk out of its middle.

⚠️ This changes what a two-argument `parseFile` returns for an email of this
shape, so `ab-diff` WILL report a difference on one — and that difference is the
fix, not a regression. It is deliberately not an opt: `Docparse/index.html`
showing thirteen items for a one-item ATQ is the same bug, not a different
consumer's preference. Every other engine parameter rule in this file still
holds.

`atq-revision.test.js` pins all of it, engine half included, against the real
attachment set.

## Save — one Dataverse record, TEMPORARILY

An ATQ covering "Item 2 & 3" really is **two** `admin_purchaserequest` records,
and procurement sends one email per item to produce them — that is the end
state, and the subject's trailing bracket is what says which item an email is
for. Until that per-item flow is finished, **one upload writes exactly one
record**: the item on screen.

Two halves, both temporary, both pure and both pinned by `recordid.test.js` /
`render.test.js` so restoring per-item saves is a deliberate edit rather than a
silent one:

- `planSavesForItem` returns a list of length 1. `assignRecordIds` still runs
  over **every** item before the pick — its `-a`/`-b` collision suffix is only
  correct against the whole set, so narrowing the input instead of the output
  would hand item 2 an id that silently overwrites item 3's in Dataverse. The
  index is clamped, because an item tab can outlive the records behind it for a
  render and an out-of-range read would save a record with no id at all.
- `savedRecordIdOf` closes the door after the write. Derived from
  `savedRecordIds` rather than kept as its own flag, so "has this upload written
  anything" has one answer; `resetRecordData` / `toggleDemo` already clear that
  map, which is exactly when a new record legitimately starts. A **failed** save
  never reaches the map, so the lock stays open and the retry still works.

⚠️ **The second half is now PER ITEM, not per upload** — see "Process Another
Item" below. `savedRecordIdOf` takes an optional second argument, the Record_ID
of the item on screen, and App passes it. `planSavesForItem` is unchanged and
still returns one plan: one Start-to-Save pass still writes exactly one record.
What changed is that a second pass, for a different item of the same email, is
no longer refused.

## Process Another Item — the same email, the next item

An ATQ covering "Item 2 & 3" arrives as ONE email carrying the documents for
both. The end state is one email per item, but until procurement sends them
that way the reviewer has everything they need in front of them already — so
the dev side lets them go round again rather than asking for an email that will
never arrive.

The card sits on **LIS & Remark** (`FEATURES.processAnotherItem`, dev only) and
is a **Process Another Item** button ALONE. It lands the reviewer back on the
Document Workbench with the next unsaved item selected and the item lock
released; they pick the item there if it is not the one they wanted, re-pick the
role documents and press **Start** again, and the new item's own Record_ID is
what gets created.

### The picker moved to the Document Workbench (2026-09-21)

The card used to carry its own dropdown of every item, greyed where finished,
with the button beside it. That dropdown is gone: **the item is chosen in one
place, the Workbench's own `Which ATQ Item No. to process` selector**, which is
the page where the choice actually takes effect. The greying moved with it —
`PrpoExtractedFieldsCard` draws its options through the same
`itemProcessOptions` the LIS card used, so "already saved to master" is readable
from the only surviving picker.

Two things the move brought with it:

- **The button's target is DERIVED, not state.** The old dropdown's draft
  selection was a `useState` seeded from the first open item; with the select
  gone there is nothing for a reviewer to have chosen there, so a stale
  initialiser would be the only way the button could disagree with
  `savedRecordIds`. `nextOption` is recomputed every render.
- **`itemPickHint` is the arrival cue: the page DIMS and the selector alone is
  lit.** The Workbench looks exactly like the page the reviewer started this
  upload on, so `processAnotherItem` raises a one-shot flag that draws the same
  whole-viewport `fixed inset-0 z-40 bg-black/45` backdrop the Back-to-Back gate
  uses, raises the selector through it on a painted `z-50` panel, rings it,
  scrolls it into view, and says in a sentence what to do. Three details:
  the backdrop is FIXED and whole-viewport, or the sidebar and TopBar — where a
  reviewer arriving from LIS & Remark is most likely still looking — stay lit;
  the selector needs a panel of its own, since a bare pill at `z-50` has the dim
  showing between its own words; and clicking the dim CLEARS the hint, because
  this is a cue and not a gate — nothing is being refused, and a reviewer happy
  with the item already selected must not be left dimmed with no move but to
  open a dropdown they did not want.

  Cleared by `selectItem` itself — set ABOVE its `i === itemIndex` early return,
  or re-picking the item already on screen would leave the cue standing — and
  wherever the record resets. Withheld when the selector is locked or the upload
  covers one item: a cue pointing at a control that cannot answer it is worse
  than none.

Three more things this depends on, and each of them was the obvious wrong call
first:
- **`done` means processed or saved.** Active only when returning via **Process Another Item**
  (`filterProcessedItems === true`; disabled for a new record so all items remain selectable).
  An item is marked done (disabled) if:
  1. It was saved in the current session (`savedRecordIds`);
  2. It was started in the current session (`lisStartWritten`);
  3. Or it exists in Dataverse `records` matching the same ATQ no (`admin_atqno` /
     `atqNo` / `recordId` prefix) and same Item No (`admin_itemno` / `itemNo` /
     `recordId` suffix), excluding cancelled records (2026-09-30).
  `itemProcessOptions` filters records for the current ATQ number, so processed
  items on this ATQ are disabled on Document Workbench without affecting items of
  other ATQs.
- **A greyed item stays in the LIST.** `AnimatedSelect` learned an optional
  per-option `disabled` for this. An item that simply vanished from the picker
  would read as "this ATQ never covered one". The Workbench selector also keeps
  its floor of ONE option for an upload the records do not back — `itemOptions`
  falls back to a lone `Item 1` rather than to `itemProcessOptions`' empty list.
- **`processAnotherItem` undoes three things and no more**: the item lock,
  `saveStatus` (a partial-failure panel about the previous item would be read as
  being about this one), and the page. `savedRecordIds`, `atqExcelWritten`,
  `lisStartWritten` and `processStage` all deliberately SURVIVE — they are keyed
  by Record_ID and the new item has its own, so clearing them would both
  duplicate the finished item's Dataverse rows on a revisit and lose the greying
  the picker draws from them.

The TopBar's plain item view-switcher on LIS & Remark is drawn only where this
card is not. Two item pickers on one page meaning two different things — "which
item is DISPLAYED" and "which item to go and process next" — is not a layout
problem, it is a wrong-record problem. The 2026-09-21 move answers the same
hazard one page further out: there is now ONE item picker in the whole dev flow.

`goSave` is untouched by all of this and still loops over whatever `savePlans`
holds, sequentially (not `Promise.all` — Dataverse throttles, and a sequential
loop leaves a describable partial state). On a failure partway through,
already-written records are kept — there is no rollback — and `savedRecordIds`
makes a retry idempotent. `buildRecordPayload` is a pure function precisely so
this can be tested without a real `Xrm.WebApi`; keep new Save-payload logic
inside it rather than back inline in `goSave`.

The lock is said on screen as well as enforced: a disabled Save button with no
explanation and "this ATQ has another item still to save" are the same pixel
otherwise, and only one of them is a problem the reviewer can act on. Note that
`PrimaryButton` takes only `children`/`onClick`/`disabled`/`className` — a
`title=` on it is dropped without a word, which is why the reason lives in a
panel and `render.test.js` asserts no `title` is there.

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
node _test/app-harness/extracted-fields.test.js  # the Process -> Verify preview grid
node _test/app-harness/quotation-fields.test.js  # quotation labels + per-item Quotation slot
node _test/app-harness/agreement-fields.test.js  # a SCANNED agreement's labels
node _test/app-harness/chop-owner.test.js    # whose chop / whose signature
node _test/app-harness/n8n-send.test.js      # which documents "Send to n8n" posts
node _test/app-harness/sheet-fields.test.js  # what a spreadsheet's CELLS contribute
node _test/app-harness/table-fields.test.js  # what a PDF table's ROWS contribute
node _test/app-harness/email-subject.test.js # what the email SUBJECT contributes
node _test/app-harness/email-preview.test.js # what the viewer can SHOW: email + text formats
node _test/app-harness/atq-revision.test.js  # one ATQ arriving at two revisions
node _test/app-harness/side-schema.test.js   # which side this copy is, and its schema
node _test/app-harness/master-records.test.js # the Master Records page + its Manage modal
node _test/app-harness/cos-control-file.test.js # the monthly COS control file, unzipped
```

`chop-owner.test.js`, `atq-revision.test.js` and `email-preview.test.js` are
the three tests here that reach into the ENGINE.

`chop-owner.test.js`:
`attachMarkContext` takes boxes and marks already normalised to page fractions,
so its column and cue rules run under plain Node with no canvas and no OCR. Its
fixtures are measured geometry from real pages in `Demo Data/chop/`, not
invented shapes — if you change a threshold, change the fixture only if you have
re-measured, because a wrong column silently attributes a chop to the other
party and looks exactly like a right answer.

⚠️ The glyph vocabulary is load-bearing, not decoration. `✓` / `≈` / `≠` carry
agreement, softened split and hard split on both the field row and Verify — the
point being that a reviewer who cannot tell `#3D8B5F` from `#B78312` still reads
the row. The redesign commit (`b86175e`) flattened all of them to `-`, `~`,
`OK` and `...`, dropped every `→`/`←`/`—`/`…`, and left one mojibake
(`v2 蝜?SB Back-to-Back`); the working tree has them restored from `HEAD~1`.
`render.test.js` now asserts each glyph individually, checks the source for `�`,
and rejects a ternary with two identical branches — the scar a flattened
`{on ? "✓ X" : "X"}` leaves.

⚠️ Where the conflict marks are drawn moved with the upload/parse redesign: page
1's field grid is read-only now, and `renderFieldInput` — the ring, the flag
button, the capsules, the compare panel — runs only in the document viewer's
"Extracted Field" tab. `render.test.js` asserts both halves of that (page 1
draws no ring; the row still does), so putting the grid back has to be a
deliberate edit to the test rather than a silent one. `UploadPage`'s
`renderField` helper is currently dead code left behind by that move.

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
themselves needs a real browser (`Docparse/CLAUDE.md` has the ladder for the
engine's OCR side) and, for Save specifically, the real Model-Driven App — there
is no local substitute for `parent.Xrm.WebApi`.

When the engine changes, also run the `ab-diff` check described in
`Docparse/CLAUDE.md` — the app-harness tests do not touch
`Docparse/docparse-engine.js`'s own compatibility guarantee toward
`Docparse/index.html`.

## App version number (`APP_VERSION`)

`PR Assistant App.html`'s `APP_VERSION` constant (shown under the sidebar's
"+ New Record" button) is `MAJOR.MINOR.PATCH`, started at `1.0.0` on
2026-08-27 (no prior version existed to continue from). Whoever makes a
user-visible change to the app bumps **exactly one** segment before calling
the work done, and resets every segment to its right to `0`:

- **MAJOR** — a big update: a redesign, or a change that reshapes how an
  existing page/flow works (e.g. Save's per-item flow becoming genuinely
  per-item, or another Customer-PO-scale removal/restructure).
- **MINOR** — a small update or a function added: a new column, a new field,
  a new page section, a new page — adds capability without reshaping what's
  already there. (Example: repointing Master Records at
  `admin_btb_lis_excel_datas` and adding its Status/Flagged columns was one
  MINOR bump, `1.0.0` -> `1.1.0`.)
- **PATCH** — a bug fixed or a problem solved: behaviour was wrong and is now
  right; no new capability.

Bump it **without being asked**, as the last step of the change — the user has
had to ask for it more than once, and a file whose version did not move is
indistinguishable in the browser from one that was never re-uploaded.

One bump per logical change, not per file edit or per commit — several edits
in service of one feature (e.g. the fetch query, the table columns, and the
sidebar counts all landing together) still bump only once. Displayed as
`V<APP_VERSION>` (capital V) in the sidebar.

## Print — a separate document, not this window

The Documents Viewer's header carries **🖨 Print** beside **⤓ Download**. It is
deliberately **not** `window.print()`: this app is normally an iframe web
resource inside a Model-Driven App, so printing the window prints the app's own
chrome wrapped round the document. What a reviewer means by Print is "the
document I am looking at, every page of it" — a separate document handed to the
browser's own print dialog.

Split in two, for the same reason `buildRecordPayload` is a pure function:

- `printableFor(doc, entry, url)` — pure, DOM-free, so the harness can test
  **what** would be printed. Returns `{mode:"pdf"}`, `{mode:"html", html}` or
  `{mode:"none", reason}`. It mirrors `PreviewPane`'s own order: the three kinds
  fed by the parse tree (sheet / html / text) print even when the blob was
  dropped, and only after them does an absent blob become a refusal. The three
  refusal sentences are the ones Download already uses, so the two buttons can
  never disagree about why they are off.
- `printDocument` / `openPrintFrame` — the half that touches the page, and only
  a browser can check it.

Three things that look arbitrary and are not, and the first two were learned
the hard way:

- **The PDF is RASTERED through pdf.js, never handed to the browser's own PDF
  viewer.** The first version pointed a hidden iframe at the object URL
  (`frame.src = blob:...`). Measured in the real Model-Driven App, that produced
  **total silence**: no dialog, no error, and nothing to report either — the
  frame's `load` event never fired, so `print()` was never reached, and an
  iframe does not fire `error` for this. Two things have to go right for that
  route and both are the host page's to decide: the frame navigation, and the
  plugin that renders it. A `data:` URL image inside `srcdoc` is neither, so
  there is nothing left to be blocked. It costs a render pass per page, which is
  why printing now reports progress.
- **A watchdog, because a `load` that never arrives is the actual failure
  mode.** `PRINT_LOAD_TIMEOUT_MS` turns "wait forever in silence" into a
  sentence in the header. Without it the rewrite above would fix this one
  symptom and leave the next one just as invisible.
- **The frame is hidden by being OFF-SCREEN, not by `visibility`/`display`.** It
  has to lay its pages out before the dialog can show them.
- **A workbook prints EVERY worksheet, not the selected tab.** `sheetIndex` is
  deliberately not a parameter of `printableFor` — a print of the visible tab
  alone is indistinguishable from a one-sheet workbook, and the reviewer has no
  way to tell which they got.

Beyond that, two fallbacks in order: a host frame sandboxed without
`allow-modals` (`sandboxBlocksModals`, readable only when the host is
same-origin) goes straight to `printInNewTab`, and so does a hidden-frame
attempt that throws. A blocked pop-up is then reported — which is more than
silence ever was.

⚠️ **A PDF prints from the BYTES, so `printableFor` does not make it wait on the
viewer's object URL.** That URL is the viewer's own, for `<img src>`, and the
image branch still needs it; the `"Preparing…"` refusal therefore sits below the
PDF branch, not above it. It was above it while the blob: route existed, and
leaving it there would refuse to print a document that is perfectly ready.

⚠️ `print()` inside a sandboxed frame is a **silent no-op** — it does not throw,
so no `catch` can see it. That is what `sandboxBlocksModals` is for, and it can
only answer when `window.frameElement` is readable. Whether the real
Model-Driven App frame needs that path can only be checked there.

## The email formats preview as the email, not as a filename

`.xlt` was the measured gap in "Every spreadsheet format, from one list" below.
The email formats had three of their own, and all three looked on screen exactly
like a format nothing can read — a filename and a download button.

**1. `.msg`/`.eml` had no visual original at all.** `processMsg` reads
`msg.bodyHtml` and `processEml` reads `email.html`, and both threw the HTML away
through `stripHtmlToText` the moment they had it. For the TEXT pass that is
still right — a price table reads as prose either way and the cross-check only
ever wanted the words — and it is the wrong answer for a reviewer, because an
email's tables, its bold, and the company chop somebody pasted straight into the
body ARE the document. `buildEmailPreviewHtml` keeps a second, **render-only**
copy beside the text, the way `.mht` always had one.

**2. An email inside an email was one skipped attachment.** `parseByExt` refused
`msg`/`eml` at any depth but 0, so a forwarded PR request's own agreement and ATQ
were never reached — `parseByExt` returned `null`, the doc came back
`status: 'skipped'`, and nothing said why. The ceiling is now the same one `.mht`
has, `depth <= 1`, and for the same reason: at depth 2 the inner email's
attachments would start unpacking emails of their own.

**3. Plain text did not work at ALL, at either end**, and the first pass at
this only found half of it. `previewKindFor` has answered `'text'` for a `.txt`
since the beginning and **`parseByExt` had no branch for one** — the two halves
had simply never agreed. So a `.txt` ATTACHMENT came back `status: 'skipped'`
with the engine's own apology in its `textBlock`, and a `.txt` dropped on its
own threw `Unsupported file type: .txt` at upload. Fixing the App alone left the
attachment case exactly as broken as before, because there was nothing to draw:

- **engine** — `processText` behind `textAttachments`, reading the bytes into
  blank-line-separated paragraph blocks and handing them to `summarizePages`.
  The same shape the layout pass gives it for a PDF, so a text file's
  `Quotation No.: X` line becomes an Extracted Field by the ordinary rules
  rather than by a second copy of them.

⚠️ **The UTF-8 BOM needed nothing, and the first attempt at it was dead code.**
`TextDecoder` strips a leading one unless `ignoreBOM` is set, so a hand-rolled
`/^﻿/` replace changed nothing — found by mutating it and watching the test
stay green, not by review. What DOES have to be read is **UTF-16**, and Notepad
is why: its "Unicode" save is UTF-16LE, and those bytes through a UTF-8 decoder
come back as replacement characters with a NUL after every letter — mojibake on
screen, every label missing, and nothing anywhere reporting a problem.
`charsetFromBom` sniffs the first two bytes for that, `0xFF 0xFE` / `0xFE 0xFF`,
and `email-preview.test.js` pins both endiannesses **and** that swapping them
fails.
- **App** — `PreviewPane`'s text branch reads `doc.textLines`, and `selfDocFor`
  is the only thing that ever set it; every other document carries only
  `doc.textBlock`, which no preview read. `textLinesFor` is what both
  `PreviewPane` and `printableFor` ask now.

`TEXT_EXTS` is `txt log md json ini`. **`csv` is deliberately not in it** — it is
a `SHEET_EXTS` member and reads far better as a grid — and neither are
`html`/`htm`, which already have an html preview. The engine exports the list so
`email-preview.test.js` can assert **containment** in the App's own
`VIEWER_TEXT_EXTS`: the App's is wider (it also carries `eml`/`msg`, which are
containers rather than text files), but a format the engine reads as text and the
App calls `'other'` gets a download button instead of a pane.

### The three engine halves are opts, and ab-diff is why that matters

`emailPreviewHtml`, `nestedEmails` and `textAttachments` all default off, same
rule `markContext` and `markCrop` follow: `previewHtml` and an attachment's
`status` are both part of `parseFile`'s result, and `textAttachments` turns a
`throw` into a result — every one of those is a visible output change, and
`Docparse/index.html`'s two-argument call must not see any of them. All four App
call sites pass all three, and `email-preview.test.js` counts them: an opt the
App forgot to ask for does not fail, the feature simply never appears for
whichever upload path missed it.

⚠️ **`ab-diff` cannot see the text branch.** `ab-dump.js` only ever looks at
`pdf`/`xlsx`/`xls` attachments, so a `.txt` never reaches it. What holds the
guarantee there is the branch returning `null` without the opt — byte-identical
to having no branch — and that is pinned behaviourally instead: with two
arguments `parseFile` on a `.txt` still throws `Unsupported file type: .txt`,
which is the assertion to keep if the branch is ever restructured.

Measured after the change: `ab-diff` over the seven-email corpus is
**LOST 0 | GAINED 0 | CHANGED 0 | 0 of 58 attachments differ**. That is the
whole point of the gating, and it is the opposite call from `dedupeAtqRecords`
and `SHEET_EXTS`, where the output change *was* the fix. Here `index.html` is not
wrong today: it renders a `.mht` and shows a download button for a `.msg`, which
is a consumer preference rather than a bug.

⚠️ **`previewKindFor('eml')` is still `'other'`, deliberately.** It takes an ext
and no opts, so it cannot know whether the preview was built. What decides
instead is `applyAttachmentResult`: `if (doc.previewHtml) doc.previewKind =
'html'` — a container that produced a self-contained rendering of ITSELF can be
shown, whatever its extension suggested before the parse ran. A no-op for every
other format, because nothing else fills `previewHtml`.

### Two lists of parts, not one shared list

`buildEmailPreviewHtml` is **not** given the descriptor list
`processEmailAttachments` reads. That list goes through `isInlineFurniture`,
which returns true for **any** part carrying a `contentId` — so handing it the
contentIds the preview needs would re-classify every real attachment of every
`.msg` as layout furniture. Same for `mimeType`: adding it would change what
`extFor` answers for an attachment whose filename has no extension. So
`processMsg`/`processEml` build a second, preview-only list, and the test pins
that the parse-side descriptors carry neither field.

Four things inside the preview builder, each the reason a measured case works:

- **A `cid:` reference resolves against the email's OWN inline parts and nowhere
  else** — the `.mht` Content-Location problem one layer further in. `data:`
  URLs, not `blob:`, for the reason `buildMhtPreviewHtml` records: a
  `sandbox=""` iframe has an opaque origin and Chrome will not load a `blob:`
  subresource into one.
- **`normEmailCid` strips the `<>` and lowercases.** A MIME `Content-ID` header
  carries `<image001.gif@01DA>` and the `<img src>` never writes the brackets.
  Matching literally leaves every Outlook logo unresolved, and that does not
  fail loudly — it just shows nothing.
- **Only the parts the page actually paints with are decoded**, and images only.
  An email with forty attachments and one inline logo decodes one; a `cid:`
  pointing at a PDF is blanked rather than spending the budget on something that
  renders nothing. The ceilings are `MHT_INLINE_MAX` / `MHT_TOTAL_MAX`, shared
  with the archive path.
- **An unresolved `cid:` in a `src` is blanked; in an `href` it is left alone.**
  Under `sandbox=""` the link is inert, whereas a broken-image glyph says less
  than nothing about an email that is otherwise complete. `stripActiveHtml` then
  blanks every absolute `src` too, which in mail means the tracking pixels
  Outlook itself blocks by default.

### `textLinesFor` is the one answer, and it refuses two things

`PreviewPane` and `printableFor` both ask it, so the Preview pane and the Print
button can never disagree about whether a document can be shown. Two refusals
carry more weight than the coverage they cost:

- **a doc that is not `parsed`.** `applyAttachmentResult` writes its own apology
  into `textBlock` for a skipped or failed document (`unsupported file type,
  skipped`), and rendering that in the text pane presents the engine's error
  message as the document's contents.
- **`textBlock`'s own `=== Attachment: name ===` header**, which exists for the
  container's `plainText` and is not part of the document. A reviewer reading it
  above the text would reasonably think it was in the file.

`VIEWER_TEXT_EXTS` (App) is what routes `previewKindForExt`. `eml`/`msg` are in
it for the email with no HTML body at all. **`xml` is deliberately absent**: a
`.xml` attachment is as likely to be Excel 2003 SpreadsheetML as text, and a
workbook shown as a wall of tags is worse than offering a download.

### What the spreadsheet side does NOT cover, measured

`SHEET_EXTS` lists 17 formats and the viewer previews every one it can read, but
"listed" is not "readable". Against the vendored `Docparse/xlsx.full.min.js`
(SheetJS **0.18.5**), round-tripped under Node:

- read confirmed: `xlsx xlsm xlsb xls ods fods csv dif slk dbf`, plus
  `xlt xltx xltm` — the templates are the **same container bytes** as their
  workbooks and `processExcel` passes no format hint, so they take the same
  path; and `numbers`, whose `Index/Document.iwa` branch and its `Lb()` parser
  are both present in this build.
- **`xlw` almost certainly cannot be read.** An Excel *workspace* is a list of
  pointers to other workbooks with no `Workbook` stream, and the bundle contains
  no `xlw` string at all.
- **`et`/`ett` depend on the file.** Older WPS writes xls-compatible CFB and
  reads fine; newer zip-based ones hit `Unsupported ZIP file`.

Neither crashes: the read throws, no sheet has `html`, and
`PreviewPane`'s sheet branch falls to "This spreadsheet has no readable sheets —
download the original." Honest, but not a preview. Changing that is a SheetJS
version decision, not a list edit, so **do not quietly drop `xlw`/`et`/`ett`
from `SHEET_EXTS`** — parsing them is what would break, and the list is also
what makes them previewable the day the build can read them.

## Every spreadsheet format, from one list

`SHEET_EXTS` in `Docparse/docparse-engine.js` is the single source of truth for
"is this a spreadsheet". **`previewKindFor` and `parseByExt` both read it**, so
"the viewer shows it" and "the parser reads it" cannot drift apart — widening
one alone gives either a `.xlt` that previews but yields no fields, or one that
parses but shows as an undisplayable `other`.

It exists because `.xls`/`.xlsx`/`.csv` were the only three recognised, and
**`.xlt` — an Excel TEMPLATE, which a sender produces simply by saving from a
template file — fell through to previewKind `other`**: a filename and a download
button, no preview and no fields, on screen indistinguishable from a format
nothing can read. The list is now every flavour SheetJS reads: the Excel family
(`xlsx xlsm xlsb xls xlt xltx xltm xlw`), OpenDocument (`ods fods`), WPS
(`et ett`), Apple Numbers, and the plain tabular interchange formats
(`csv dif slk dbf`).

Widening it is genuinely the whole change: `processExcel` calls
`XLSX.read(buf, {type:'array'})`, which sniffs the bytes and takes no format
hint, so nothing downstream branches on which flavour arrived.

**Deliberately NOT in the list: `txt`, `html`/`htm`, `prn`.** SheetJS parses all
three, but they already resolve to text/html previews that are right far more
often — a `.txt` shown as a one-column table is a regression, not support.

Three copies live outside the engine and `sheet-fields.test.js` pins all three
against it by reading the files as text:

- `VIEWER_SHEET_EXTS` in the App — the fallback `previewKindForExt` uses when
  `DocparseEngine` is not loaded yet (the harness, and the paint before the
  asset loader finishes). `sheetExts()` prefers the engine's at run time.
- `DROP_PARSABLE_EXTS` in the App and in `Docparse/index.html` — both **spread**
  the spreadsheet list rather than retyping it. Both were moved ABOVE
  `collectDroppedFiles` to get them out of the window `outlook-drop.test.js`
  pins between the two files: that test compares the drop-handling statements,
  and each side legitimately sources its list differently (the App from its own
  fallback const, Docparse straight from `DocparseEngine.SHEET_EXTS`).
- `ACCEPT_EXTS`, the two file pickers' `accept=`, is **derived** from
  `DROP_PARSABLE_EXTS` — a picker that turns away a format the drop handler
  parses is a bug nobody reports, because the file simply never opens.

⚠️ This changes what a two-argument `parseFile` returns for a `.xlt` (and every
other newly-listed format), so **`ab-diff` will report a difference on one — and
that difference is the fix**. Same call as `dedupeAtqRecords`: `Docparse/index.html`
showing a download button for a workbook it can read is the same bug there, not a
different consumer's preference, so this is not an opt. Every other engine
parameter rule in this file still holds.

⚠️ **`isAtqWorkbookFile` and `isWorkbookRecord` still test `/\.xlsx?$/i`**, on
purpose and NOT widened here. "Which files can be read" and "which workbook is
an ATQ" are different questions, and the second decides whether per-item records
are parsed at all. An ATQ that arrives as `.xlsm` or `.xlt` therefore previews
and contributes fields but offers no item list — decide that one deliberately
rather than by inheriting this list.

## The COS control file — written by hand, because SheetJS will not write it

Master Records' **COS Control File** button (dev side, `FEATURES.cosControlFile`)
hands the reviewer an EMPTY copy of procurement's own monthly workbook:
`202608 COS control file_V0 1.xlsx`, 18 coloured headers across A:R, fixed
column widths, thin borders, a 60pt header row and an AutoFilter. The reviewer
picks a month and a blank-row count; column A comes out filled and everything
else is typed in afterwards.

**The workbook is assembled as OOXML strings and zipped in the App, not written
through SheetJS, and that is the load-bearing part.** The vendored build is
**0.18.5 community, which READS cell styles and does not WRITE them** — a
`XLSX.writeFile` of this sheet comes out with every one of the 18 headers white.
The reviewer would then re-colour them every month, which is the entire job the
button exists to remove. So `buildCosStylesXml` / `buildCosSheetXml` emit the
parts directly and `zipStore` packs them **STORED (uncompressed)**: Excel opens a
stored entry identically to a deflated one, and the alternative is pulling a
compression library into a file that has no build step. `crc32` is the one value
a zip needs that JS has no builtin for.

This is deliberately **not** a widening of `SHEET_EXTS` or anything else in the
engine. Nothing here goes near `Docparse/docparse-engine.js`: it is a document
the App *produces*, not one it reads, so none of the two-argument `parseFile`
guarantees are in play and `ab-diff` is structurally blind to all of it.

**Report Month is the month BEFORE the one that names the file.** The real file
is called `202608 …` and every one of its rows says `2026/07` — the August file
reports July. `cosReportMonth` is the only place that says so, and
`cosControlFileName` deliberately does **not** go through it: picking 2026/08 has
to give the 202608 file, not a 202607 one. The dialog prints both the file name
and the Report Month it is about to write *before* generating, because a reviewer
who did not expect the two to disagree should meet that here and not in a
downloaded workbook. The sheet is named for the year the rows **report**, so a
January pick tabs `2025`.

Four things about the transcription that look fussy and are not. Each was read
off the reference workbook's own `sheet1.xml` / `styles.xml`, never eyeballed —
a header that is nearly the right orange is indistinguishable on screen from one
that is right, and nothing on either side reports the difference:

- **Two different reds.** `AO / Input Person Name` is `FF0000` and
  `Unit Manager Name` is `EE0000`. Collapsing them into one red is the change
  nobody would notice until procurement did.
- **`"Vendor Invoice Date "` carries a trailing space** and
  `"Currency\n(e.g. HKD,USD)"` carries a real newline. Both are in the original;
  the newline is why every header cell has `wrapText`.
- **Column A is TEXT, not a date.** The real file's A cells are shared strings
  reading `2026/07`. Written as a date it would render as `7/1/2026` in whatever
  locale the reviewer's Excel is set to.
- **Every blank cell is still written, with its style.** A genuinely absent cell
  loses its border and its number format the moment somebody types in it, and
  handing over a bordered, pre-formatted grid is the whole point of the button
  rather than a header row.

`cos-control-file.test.js` **unzips the bytes the button would download** and
reads the OOXML back — cell → style index → xf → fill → rgb, the way Excel
resolves it — against a transcription of the reference workbook held in the test.
It walks the central directory itself rather than using a zip library, because
reading the bytes back with the writer's own assumptions would prove nothing.
The reference file is procurement's and is **not in the repo**, which is exactly
why the expected values are transcribed into the test: a check that needs a
document nobody has is a check that gets deleted. It also pins `crc32` against
the published check value for `"123456789"` (`0xCBF43926`), the feature flag
against the side, and both render sites being behind that flag.

⚠️ Two halves only a browser can answer, and neither fails loudly: whether the
Model-Driven App's iframe allows an `<a download>` at all (the same route
`Export Excel` already takes), and whether real Excel — fussier than
`openpyxl`, which reads the output correctly — offers to repair the file.

## A `solo` row's LIS Value box IS the row

`solo` rows (Product Type, IPT Unit Mgr, UID) draw **neither a Value cell nor a
Cross Check cell** — both `<td>`s are rendered empty. The LIS Value box is the
only thing on screen for them, so whatever seeds that box is what the reviewer
reads, and "the Value is right" is not a claim anyone can check by looking.

That is how `FEATURES.verifyAtqExcelDataverseOnly` came to be half-working.
`atqExcelValueForRow` correctly made `admin_iptunitmanager2` the one and only
Value for IPT Unit Mgr — and then `lisValueForRow` seeded the box from the
**BTB_LIS_Excel_Datas** reading first:

```js
lisCellValue(dataverseVerify, row.lisSourceKey || key) || autoValue || ""
//  admin_iptx0020unitx0020mgr  wins        admin_iptunitmanager2  never seen
```

so a LIS row that already held a value beat the ATQ Excel column every time.
Reported as *"not blank, it not show the table admin_btb_atq_excels column
admin_iptunitmanager2 value"* — which is the shape of this bug: the row looks
answered, and only a comparison against Dataverse shows it is answering from the
wrong table.

**Product Type escaped it by accident, and that is why the fix is a per-row
flag.** The dev `lis` schema has no `productType` key at all, so `lisCellValue`
returned `""` and the ATQ Excel value fell through. Same feature flag, opposite
outcome, decided entirely by whether the OTHER table happens to have a column.
`lisSeedPrefersValue` is therefore set on IPT Unit Mgr alone (user's call,
2026-09-25) rather than derived from `atqExcelDataverseOnly` — give the LIS table
a `productType` column one day and Product Type breaks exactly as this row did.

Two things the flag deliberately does not touch:

- **The reviewer's own box still wins.** `lisSeedPrefersValue` reorders the two
  AUTOMATIC tiers only; the `selectedLisValues` own-property check stays above
  both, so a cleared cell stays cleared.
- **The write moves with the screen.** `iptUnitMgr` is in `LIS_EXCEL_ROW_IDS`
  and `lisExcelValueForRow` reads through the same `lisValueForRow`, so
  "Continue to save" now writes the BTB_ATQ_Excel value back into
  `admin_iptx0020unitx0020mgr`. That is a real change to what is saved, and it
  was confirmed before it was made — fixing only the render would have put a
  value on screen that Save did not agree with.

Pinned in `extracted-fields.test.js` beside the existing `atqExcelDataverseOnly`
case, asserting the **absence** of the LIS reading as well as the presence of the
ATQ Excel one: "the ATQ Excel value wins" and "both are somewhere on the page"
are different claims and only the first is the fix.


### Read from one table, write to another — and the names share nothing

Two Verify Table rows are read from **BTB_ATQ_Excel** and written to
**BTB_LIS_Excel_Datas**, under names with nothing in common:

| Verify row | read (BTB_ATQ_Excel) | write (dev BTB_LIS_Excel_Datas) |
|---|---|---|
| Product Type | `new_product_type` | `admin_producttype` |
| Contract Revenue | *Contract_Revenue, logical name not yet transcribed* | `admin_totalrevenue` |

A column name arriving on its own says **nothing about which direction it is
for**. On 2026-09-28 both of these were put into `SCHEMA.atqExcel.fields` — the
READ map — because the request named the Verify Table and that is where the
Verify Table's Value comes from. Both were the WRITE targets. Ask which
direction before transcribing: "the Verify Table's Product Type value" and
"what Continue to save writes" are two different columns on two different
tables, and only one of them fails loudly.

**Three tables spell Product Type three ways**, which is what makes a
half-remembered name dangerous here:

```
admin_btb_atq_excels          new_product_type      the VALUE the row shows
admin_btb_lis_excel_datas     admin_producttype     what Continue to save writes
admin_btb_ccc_wocode_accode   admin_producttype2    the Pair lookup's own
```

⚠️ **Both LIS columns are in `write` ONLY — never `fields`, never `select`.**
This is the load-bearing part, not tidiness. `lisValueForRow` seeds a row as
`lisCellValue(…) || autoValue`, so the moment the LIS table can *answer* for
`productType`, its reading outranks the BTB_ATQ_Excel value that
`FEATURES.verifyAtqExcelDataverseOnly` exists to make the row's only Value —
the IPT Unit Mgr bug of 2026-09-25, reproduced exactly, and predicted in this
file in as many words ("Give the LIS table a productType column one day and
Product Type breaks exactly as this row did"). Keeping the column out of
`select` is what makes `lisCellValue` return `""` and the ATQ Excel value fall
through, and is why **no `lisSeedPrefersValue` flag was needed**.

**Contract Revenue reuses the existing `totalRevenue` schema key** rather than
adding a `contractRevenue` one, because both would name `admin_totalrevenue`.
Two keys on one column is a last-one-wins inside `mapPayload`, visible only as
a value that will not stick. The `values` key stays `contractRevenue` — that is
the Verify ROW id `lisExcelValues` is keyed by; only the SCHEMA key is shared.
There are now two writers of that column (this, and `buildRecordPayload`'s own
form field) and they cannot erase each other for one reason only: `mapPayload`
drops `""`.

Dev only. The Admin LIS table's equivalents have not been transcribed, so
`mapPayload` drops both keys there — the ordinary guard, not an omission.

### BTB / NON-BTB is written at Start, and the vocabulary changes on the way

The Document Workbench's **Start** writes the case into `admin_btbtype` (dev) /
`new_btb_type` (admin), alongside the four-value LIS stub. `btbTypeOf` is the
one translation and every caller goes through it:

```
the ATQ Cost sheet says           "Y" / "N"
the column, the Master Records BTB chip, the Manage
modal's <select> and APPROVER_BANDS all say        "BTB" / "NON-BTB"
```

Writing the raw `"Y"` would **not fail**. It would sit in the column reading as
neither, and `getDualApprovers`' `type === "BTB" ? BTB : NON-BTB` would band it
as NON-BTB — the wrong approval threshold, reached silently.

Anything that is not exactly Y or N yields `""`, which `mapPayload` drops, so
the column is left unwritten rather than guessed at. Deliberately not defaulted
either way: the Non-BTB gate triggers on N, so a guessed "BTB" waves an unread
Cost sheet straight past it, and a guessed "NON-BTB" demands three
confirmations for a case nobody established. The Record ID card's own BTB pill
reads the same function, so the screen and the column cannot disagree.

### ATQ no and Item No are written at Start (dev side)

The Document Workbench's **Start** writes the ATQ number into `admin_atqno`
and the Item number into `admin_itemno` in `admin_btb_lis_excel_datas` (dev only,
added 2026-09-30).

- `atqNo`: prefers the extracted form value (`fields.atqRefNo.value`), falling
  back to the selected item's Cost-sheet record or table record.
- `itemNo`: reads the selected item's Cost-sheet record (`itemNoOf(costRecord)`),
  falling back to a table record, the email subject, or 1-based `itemIndex`.

Both are passed into `buildLisStartPayload`/`writeLisStartRecord` as optional
trailing arguments. Empty strings are dropped by `mapPayload`, leaving the
columns unwritten if neither value could be established. The Admin side has not
requested these columns and its `lis.write` map carries neither, so `mapPayload`
drops both keys on Admin.

## Anti-patterns

- Don't transcribe a Dataverse column name without settling which DIRECTION
  it is for. "The Verify Table's Product Type value" is
  `admin_btb_atq_excels.new_product_type`; "what Continue to save writes" is
  `admin_btb_lis_excel_datas.admin_producttype`. Both requests name the same
  row, and putting one in the other's map was the 2026-09-28 mistake.
- Don't add `productType` or `totalRevenue` to `SCHEMA.lis.fields`/`.select`.
  They are write-only so `lisCellValue` cannot answer for them; the moment it
  can, it outranks the ATQ Excel value the row exists to show.
- Don't choose a value's TYPE for a column that already has another writer.
  Go and read what the existing writer sends. `admin_totalrevenue` is a TEXT
  column (confirmed 2026-09-17) and `buildRecordPayload` writes it with a bare
  `getVal` for that reason; `buildLisExcelPayload` was given `parseDecimal` on
  2026-09-28 and Dataverse rejected the WHOLE Continue to save, losing every
  other field in the same update. It reads like money and is not stored as
  money -- `usdOthers` and the two Quotation dates are the same trap.
- Don't add a second schema key for a column another key already names.
  `mapPayload` silently keeps the last one written.
- Don't write the Cost sheet's raw `Y`/`N` into a BTB column. It reads as
  neither and `getDualApprovers` bands it as NON-BTB without a word. Use
  `btbTypeOf`.
- Don't move engine-level container aggregation (`reconcileOcrFields`,
  `dedupeAtqRecords`, `matchQuotationAttachments`, `finalizeEmailResult`) into
  `PR Assistant App.html`. It belongs in the engine because it needs every
  attachment of an email at once.
- Don't read a company name — or anything else — out of an email's
  `previewHtml`. It is render-only, it is the ONE copy that still carries
  markup, and the field pass already read the same body as text.
- Don't hand `buildEmailPreviewHtml`'s descriptors to
  `processEmailAttachments`. `isInlineFurniture` treats any part with a
  `contentId` as layout furniture, so one shared list turns every real `.msg`
  attachment into a signature logo.
- Don't preview a document's `textBlock` without checking `status === "parsed"`.
  A skipped doc's textBlock is the engine's apology, and showing it presents an
  error message as the document's contents. Ask `textLinesFor`.
- Don't add an extension to `VIEWER_TEXT_EXTS` that `SHEET_EXTS` also claims —
  one extension, one preview kind, or the answer depends on branch order.
- Don't drop `xlw`/`et`/`ett` from `SHEET_EXTS` because the preview comes back
  empty. The list is what makes them PARSE; whether SheetJS 0.18.5 can read
  them is a different question, and it is written down above.
- Don't change what `entry.parsed` means. Add a new flag instead.
- Don't assume a `solo` row shows its Value cell. It shows only the LIS Value
  box, so whatever seeds that box is the row — check `lisValueForRow`, not just
  `valueForVerifyRow`, when a Verify row displays the wrong source.
- Don't derive `lisSeedPrefersValue` from `atqExcelDataverseOnly`. Product Type
  carries the second and not the first, because the dev LIS table has no
  productType column to compete with — an accident, not a rule.
- Don't add a spreadsheet extension to `previewKindFor` or `parseByExt`
  alone. `SHEET_EXTS` is the one list both read; a one-sided widening gives a
  file that previews but yields nothing, or parses but cannot be shown.
- Don't retype the spreadsheet list into a drop list or an `accept=`. Both
  are derived, and a picker that turns away a parsable format is a bug
  nobody reports because the file never opens.
- Don't rewrite the COS control file's builder to go through SheetJS. The
  vendored 0.18.5 community build writes no cell styles, so the 18 coloured
  headers come out white — and white headers are exactly the re-formatting the
  button exists to remove.
- Don't derive the COS control file's name from `cosReportMonth`. The file is
  named for the month PICKED and its rows report the month before; making the
  two agree files August's report under July.
- Don't print with `window.print()`, and don't print a workbook's selected
  sheet alone. The first prints the app around the document; the second is
  indistinguishable from a one-sheet file.
- Don't make a new engine parameter required, or change what a two-argument
  `parseFile` call does. `Docparse/index.html` depends on the two-argument
  behaviour staying exactly as it is.
- Don't run OCR before a document has a role assigned — that defeats the reason
  `deferOcr` exists.
- Don't read a company name out of `mark.text` (the chop's own OCR). It is an
  arc a line recognizer cannot read, and when it does return words they are the
  printed line beside the chop. Use `mark.context.name`.
- Don't turn `markIsOurs` into a filter. Our own chop stays visible.
- Don't use `Promise.all` for the Save loop, and don't add rollback-on-failure —
  both are deliberate choices (throttling, and a half-rollback being worse than a
  recorded partial completion), not oversights.
- Don't let the email subject fill a form field, and don't make it a fifth
  source in `computeFieldDiffs`. It decides which item is on screen and it
  corroborates; the Cost worksheet stays the document of record.
- Don't read the item number out of the UID's trailing group. It agrees with the
  trailing `(N-Vendor)` bracket most of the time and not all of it.
- Don't point the UID back at the subject line, and don't delete the subject
  tier under it. The body is tier 1 at the user's request; the subject is tier 2
  so a body that prints no UID keeps working.
- Don't read the UID off the whole `plainText`. The engine prints `Subject:`
  first, so that picks the subject by position — ask `emailBodyTextOf`.
- Don't turn `SIDE_BY_RESOURCE` into a pattern match. An unrecognised web
  resource must refuse to write, not guess a side — the two sides' tables are
  separate, and a wrong guess is unrecoverable and invisible.
- Don't write a Dataverse column name as a literal anywhere outside
  `DATAVERSE_SCHEMAS`. Every one of them is per side; the only `admin_*`
  strings that legitimately live elsewhere are the four web resource names in
  `SIDE_BY_RESOURCE`.
- Don't split the Master Records page back out into its own HTML file, and
  don't give it a version number of its own. It had both until 2026-09-17, and
  the cost was two transcriptions of the same column names that drifted (two
  truncated names, each losing a reviewer's whole Save) and two version numbers
  a user could be on. `MODE` is how one file serves a second web resource.
- Don't let `MODE` refuse the way `SIDE` does. An unrecognised resource falls
  through to the full app on purpose: the wrong page is visible and fixable,
  the wrong table is neither.
- Don't key `MODE` on a query string. `?preview=1` is how a reviewer opened the
  link, not which page they asked for.
- Don't derive one side's column names from the other's by appending a suffix.
  A dozen Admin columns carry no suffix, and one carries `24`.
- Don't let a field key with no column on this side reach `Xrm` — Dataverse
  rejects the whole create, not just that field. That is what `mapPayload` is
  for.
- Don't navigate to a page without checking `navReachable` first. A side whose
  rail does not offer the page has no way back from it.
- Don't filter `NAV_ITEMS` again at a call site. It is already the filtered
  list; filtering twice is how the rail and the step counter start disagreeing.
- Don't put a `fs-<dev>-<admin>` token on an element that also carries a
  Tailwind size class. Tailwind loads later and wins, and nothing shows an
  error.
- Don't rename a type token without changing both its rules. The name is what
  the test compares the rules against.
- Don't treat "no Admin counterpart" as proof an element has none. It usually
  means the two lines differ in some class the pairing does not normalise away.
  Go and find the twin in `App_Admin.html` before leaving a size alone.
- Don't write a size as a bare Tailwind name (`text-xs`) or a raw `clamp()` in
  markup that both sides render. Only `text-[Npx]` and the tokens are swept for
  per-side parity; the other spellings have already hidden mis-sized elements
  behind a green test run.
