# Cross-document value agreement

Design for phase 2 of `docparse/cross-attachment-field-agreement`.
Written 2026-08-10. Contains no values read out of the corpus.

## The goal

For each value the app shows under "Extracted Value", check the same value in
the other documents that arrived with it — the Agreement/Contract, the
Quotation, and the ATQ PDF. Where they disagree, mark the field and let the
reviewer see which document said what.

The ATQ workbook is the master record. The other documents corroborate it.

## What already exists

Most of the machinery is in `PR Assistant App.html` and is not being rebuilt:

- `computeFieldDiffs` walks every attachment entry, every `docs[]` entry, every
  `children[]` sub-document and one selected record per document, groups each
  comparable field by its normalised value, and reports more than one group as a
  difference.
- Normalisation already exists per field shape: `normAmount` (currency words,
  symbols, thousands separators, the local `.-` shorthand), `normRef`,
  `normDate`, `normName`. **Money already compares equal across the workbook's
  raw number and the PDF's formatted print** — no new normalisation is needed
  for the case that motivated this work.
- Severity is `same` / `similar` / `different`; only name-shaped fields get a
  fuzzy second chance, and `listCoversRest` already handles one document
  summarising another.
- A `⚠` button on the field label, dismissal keyed on the values themselves, and
  a Verify-page panel.

## The three gaps this design closes

### 1. The ATQ PDF cannot contribute item-level values

`dedupeAtqRecords` deletes `doc.records` on the PDF print whenever the workbook
is present. That is correct for counting — an email carries both, and counting
both doubled every item — but it also removes the PDF from the comparison
entirely. Of the three corroborating sources the goal names, the ATQ PDF is the
one that is structurally excluded.

**Decision: move, don't delete.** The superseded records go to
`doc.corroboration` instead of being dropped. `doc.records` keeps its exact
present meaning, so every existing reader of it is untouched: Docparse's
`appendRecords`, the App's item tabs, the "covers N items" count, the per-item
auto-fill, and the viewer's field list.

Rejected: marking superseded records in place with `rec.supersededBy` and asking
every consumer to filter. That is a Tier 0 shape change, and `Docparse/CLAUDE.md`
records what Tier 0 changes do — they break the App silently and Docparse not at
all. The blast radius buys nothing that a new key does not.

`corroboration` is additive. A consumer that has never heard of it behaves
exactly as it does today.

### 2. Items are paired by index, so multi-item ATQs compare the wrong rows

`computeFieldDiffs` selects one record per document with a single shared
`itemIndex`. Workbooks are routinely narrowed to the items a requisition covers
while the PDF prints the whole form, so index *n* of one is not item *n* of the
other. Comparing them by index reports a disagreement on every field of every
narrowed multi-item ATQ.

**Decision: pair by `Item No.`** Both record producers emit that label already.
The selected workbook record supplies the anchor item number; every other
document contributes the record carrying the same number. A document whose
records have no `Item No.` falls back to the current index behaviour. Items
present in the PDF but absent from the workbook are not compared at all — this
requisition does not cover them.

### 3. The badge names values but not documents

Today the `⚠` button's tooltip lists the values and clicking it jumps straight
to the dissenting document. The reviewer cannot see which document said which
value without leaving the field.

**Decision: a small panel.** Clicking `⚠` opens a popover listing each distinct
value with the documents that reported it underneath. Each document name is
itself clickable and opens the viewer as the button does today. Dismiss moves
into the panel.

## Fields compared

Three keys are added to `DIFF_KEYS`:

- **Product Type** — currently folded into `iptUnitMgr` and excluded as routing.
  It gets its own key. Since the 2026-08-10 cost-table fix the workbook and the
  PDF print agree on it character for character, so it is the safest addition.
- **Service Type** — needs a new `FIELD_LABEL_MAP` entry; both producers emit it.
- **Back-to-Back** — its values are single characters, below `DIFF_MIN_CHARS`
  (3), which exists as an OCR noise floor. It needs a per-key exemption rather
  than a change to the floor.

**Remark stays out.** It is free text, and the comment above `DIFF_KEYS` already
records why `projectDescription` was excluded for exactly that reason: a field
that is never identical cries wolf on every upload.

## Absence is not disagreement

A document that does not report a value, or has no item with the anchor number,
contributes nothing to the comparison and never raises a badge. Two ATQ PDFs in
the corpus cannot be read at all — one prints its cost table in a shape the
layout pass does not recognise, the other omits half its column headers from the
PDF text layer. Neither may present as a conflict. Comparison is strict equality
after normalisation between values that are actually present.

## Data flow

```
engine  processEmailAttachments
          dedupeAtqRecords ── kept ──> records / doc.records   (unchanged)
                          └─ superseded ──> doc.corroboration  (new)

app     computeFieldDiffs
          anchor = Item No. of the selected workbook record
          for each doc:  records[matching anchor]  +  corroboration[matching anchor]
          group by normalised value  ->  severity  ->  diffs[key]

ui      renderFieldInput  ->  ⚠  ->  panel: value -> [documents]  ->  viewer
```

## Verification

The engine change has an exact success criterion: **`records` output must be
byte-identical before and after.** The rung-0 A/B harness in `_test/harness`
covers all 58 attachments of the seven demo emails deterministically, so this is
a hard pass/fail, not a judgement.

The App has no test suite. Its half is verified by reading the four documented
consumers of `records` and by exercising a multi-item ATQ email where the
workbook is narrowed and the PDF is not — the case that index pairing gets
wrong.

## Out of scope

- Repairing the two unreadable ATQ PDFs. One needs Tier 3 layout work, the other
  is missing data the PDF text layer does not contain.
- Whitespace-only differences between a wrapped PDF reference and the workbook's.
  These are left to normalisation rather than guessed at in the engine.
- Any new comparison source beyond the documents already parsed.
