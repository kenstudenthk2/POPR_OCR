# Document-versus-document cross-check

Follows `2026-08-10-cross-document-value-agreement-design.md`, which built the
comparison. This one is about what the comparison is *against*, and what the
reviewer is shown.

App-side only. `Docparse/docparse-engine.js` is untouched, so none of the
verification ladder in `Docparse/CLAUDE.md` applies here.

## The problem

`computeFieldDiffs` was already document-versus-document: it normalises every
value a document reports and groups equal normalised values into equivalence
classes, so more than one class is a disagreement. That part was right.

`fieldRoleChips`, the function that turned it into the three chips a reviewer
actually sees, was not. Its reference was the form input's own value:

```js
const own = String(value == null ? "" : value).trim();
let ref = own ? String(norm(own) || "") : "";
```

So the chips answered "does each document match what is currently in this box",
not "do the documents agree with each other". Three consequences, all of them
seen by reading the code:

- Type into the box and all three chips go amber, even where every document
  agrees.
- Where the documents genuinely conflict, whichever one happens to match the box
  goes green and the field reads as settled.
- A field only one document reports got a green ✓ per role, claiming a
  corroboration that never happened. `Verify` had the same bug from the other
  end: its cross-checked test was `diff.sourceCount > 1`, and an ATQ's PDF print
  plus the workbook it was printed from is two sources in one slot.

## Decisions

### 1. All pairs among the roles, shown as a partition

Every unordered pair of roles that both spoke is compared. Not a chain
(`quotation → agreement → atq`): the Agreement is the middle link and is
routinely silent on amount, quotation reference and product type, so a silent
middle link would let a real Quotation-versus-ATQ money conflict pass.

Displayed as the partition rather than the pairs. Three roles produce three
verdicts, and one wrong document lights two of them — the reviewer then has to
intersect the pairs to find the culprit. The clusters are already in hand:
roles that landed in the same `diff.groups[]` entry said the same thing. So the
row draws roles that agree joined into one capsule, with `≠` in the gap:

```
[✓ Agreement│ATQ (PDF)] ≠ [Quotation]
```

Where exactly two roles spoke, the sentence falls back to the pair wording the
request was made in: "Agreement ≠ Quotation".

### 2. Customer PO becomes a fourth role, and it is optional

It was previously unslotted, contributing to `groups` but named nowhere. Its
customer name and amount are real values worth checking.

`optional: true` on the `DOC_ROLES` entry, and the whole point of the flag is
what it forbids:

- An absent PO produces no pair, no colour, and cannot change any field's
  verdict. Locked by an assertion that removes the PO from the fixture entirely
  and requires every field's severity to be byte-identical.
- `RoleSlotBar`'s empty slot reads "optional — none here", not "not in this
  upload".
- Verify's attachment gate asks for the four types that are not optional. The
  count still reads out of five, because five is how many tabs are on screen.
- It is **not** in `ROLE_DETECT_ORDER`. An optional document must not fill the
  form, or the form would read differently depending on whether the customer
  happened to attach their order.

Its filename pattern is deliberately narrow — `PO` is two letters that begin a
lot of words, so a bare `\bPO\b` claims `Proposal.pdf` and `Policy Schedule.pdf`.
Pinned by assertions in both directions.

### 3. The form box stops being the yardstick

Every coloured state is document-against-document. A typed value no document
backs up gets one line of neutral grey under the field — said, but never
confusable with the documents disagreeing among themselves.

### 4. Colour only where a comparison happened

`agreed` and `dissent` are the only states with colour. `lone` (one role spoke,
nothing to check against) is white-on-neutral rather than green: an overclaimed
green is what devalues every real one on the page. `silent` and `absent` are
panel-only — a row of grey chips under all twenty-nine fields puts grey in the
same traffic-light row as amber and teaches the eye to skip both.

### 5. Softening applies per pair

`tokenJaccard` / `listCoversRest` / `ourCompanyOnlyDissent` take a groups array
and are re-called on two-element slices. Strictly more accurate than the
field-wide pass: `listCoversRest` requires the listing group to cover *every*
other group, so one unrelated third value used to harden a field whose real
relationship was one document summarising another.

### 6. Dismissal stays per field

Per-pair dismissal would need a key encoding role membership, and that key
changes under a role reassignment — silently un-dismissing. `dismissKey` is
unchanged and still derived from the values, so it expires on its own.

## Shape

```
computeFieldDiffs(attachments, itemIndex)   deps [attachments, itemIndex]
roleCensus(attachments, roleOverrides)      deps [attachments, roleOverrides]
computeCrosschecks(diffs, census)           deps [diffs, census]
```

Three memos, three dependency sets, lifted into `App` so the three surfaces
cannot drift. Keeping them apart is the point: folding roles into
`computeFieldDiffs` would re-walk every document, child and record on every role
pin, to recompute a projection of what it already returned. Locked by an
assertion that pins a role and requires `computeFieldDiffs` output to be
identical.

`computeCrosschecks` re-normalises nothing and re-compares nothing. Two roles
agree iff their sources landed in the same group, so it is one bucketing pass.
Any version of it that calls `DIFF_KEYS[key]` again is the wrong version.

Per field it returns `severity` (`same` / `similar` / `different` /
`unchecked`), `refRole`, `roles` (one entry per role, `speaks` / `silent` /
`promoted` / `absent`), `clusters`, `pairs`, `intra`, `unslotted` and the
unchanged `dismissKey`.

`intra` is a slot holding two documents that contradict each other — an ATQ
workbook against its own PDF print. It counts as a conflict, and it is why the
click target is chosen by cluster weight rather than by "the side that is not
the reference": the reference can itself be the problem, and sending the
reviewer to the other role would open the one document with nothing wrong.

## Verification

No engine change, so no rung 1 or rung 2. Instead the App harness the root
`CLAUDE.md` describes was finally built, in `_test/app-harness/` (gitignored):

- `crosscheck.test.js` — 73 assertions on the pure functions, React stubbed.
- `render.test.js` — 34 assertions server-rendering the real components with the
  real React, which is where a prop that no longer arrives shows up.

Every conflict case mutates a deep clone of `DEMO_ATTACHMENTS`. No corpus
document is involved and no invented value enters the shipped file. Both suites
were mutation-checked: deliberately wrong expectations do fail and exit non-zero.

`render.test.js` caught a real defect that reading the code did not: a Verify
group covers several fields, and a group whose other fields cross-checked
cleanly was reporting green while quietly containing a field only one slot ever
reported. Passing groups now name their uncorroborated fields.

## Not done

- The browser pass. The Chrome extension was not connected in the session that
  made this change, so no screen was ever looked at.
- `detectFromRoles` picks a record by position while `computeFieldDiffs` pairs
  records by `Item No.`. On a workbook narrowed to a subset of a form's items the
  form can fill from one item while the cross-check compares another. Pre-existing,
  commented in place, left alone: fixing it changes what lands in the form.
- Verify's attachment count still reads `n/5`. Only the pass/fail test learned
  that Customer PO is optional.
