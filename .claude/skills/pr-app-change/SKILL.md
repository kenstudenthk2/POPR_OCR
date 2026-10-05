---
name: pr-app-change
description: Use this skill for ANY request to change the PR Assistant app — adding, updating, fixing or removing a field, column, page, button, label, validation, Dataverse write, or UI behaviour. Trigger on prompts of the shape "PR admin please update/add X", "PR dev please update/add X", "PR both — add X", "PR Assistant 加/改/更新 X", or any request that names the dev side, the admin side, or both sides of the PR Assistant. Also trigger when the user only describes the change without naming a file ("加多個 Remarks 欄", "the Verify Table should show Y") — the app is always the single file "PR Assistant App.html", and the skill's job is to resolve WHICH SIDE the change lands on before any edit is made.
---

# Changing the PR Assistant app

## The one file

Every change goes into **`PR Assistant App.html`** (repo root). There is no build
step: React 18 + Babel Standalone + Tailwind, all from CDN, JSX compiled in the
browser. Edit the HTML, reload the page.

That one file is uploaded to **two** Dataverse web resources and works out which
it is at load time (`resolveSide`, `SIDE_BY_RESOURCE` at `PR Assistant App.html:507`):

```
/WebResources/admin_PRAssistant.html      -> dev    SIDE = "dev"
/WebResources/admin_PRAssistantApp_Admin  -> admin  SIDE = "admin"
```

So "the dev side" and "the admin side" are **not two files**. They are two
runtime branches of the same file. A request naming a side is asking which
branch the change belongs in.

> ⚠️ `PR Assistant App_Admin.html` may still be on disk. It is the pre-merge
> original, kept only so `side-schema.test.js` section 12 can check Admin font
> sizes against it. **Never edit it** as a way of changing the admin side.

## Step 1 — resolve the side BEFORE touching anything

| The user said | Side |
|---|---|
| "PR dev …" / "on dev" / "dev side" | `dev` |
| "PR admin …" / "on admin" / "admin side" | `admin` |
| "PR both …" / "both sides" | `both` |
| **nothing about a side** | **STOP AND ASK** |

**Do not guess, and do not infer the side from the subject matter.** Ask one
short question ("呢個改動係 dev、admin 定兩邊都要？") and wait for the answer.

The reason is not tidiness: the two sides write to **different Dataverse tables**.
A change landed on the wrong side writes the admin app's rows into the dev tables,
which is unrecoverable and looks exactly like a correct save on screen. That is
also why `SIDE_BY_RESOURCE` is an explicit lookup rather than a pattern — see
`CLAUDE.md`, "One file, two web resources".

If the answer is "both", still check Step 3: a Dataverse column is never literally
shared — it needs its own entry per side.

## Step 2 — one-side-only changes go through `FEATURES`

`FEATURES` (`PR Assistant App.html:553`) is **the one place** that decides what a
side has. Do not add a second flag mechanism, and do not branch on `IS_ADMIN`
directly in new feature code.

```js
const FEATURES = {
  btbAdminName: IS_ADMIN,     // admin-only: BTB Remark "copy to" picker
  processStatus: IS_ADMIN,    // admin-only: LIS process-status timeline
};
```

A one-side feature usually needs **two** guards, not one, and both are required:

- the **UI** guard — the control does not render on the other side;
- the **write** guard — the payload path returns early when
  `SCHEMA.<entity>.write.<key>` is absent on this side.

Half of that is worse than neither. Hiding the UI alone leaves a live write to a
column the side may not have; skipping the write alone leaves a control that can
never take effect. `processStatus` is the worked example
(`markProcessStage` + `writeLisProcessStatus`).

A new helper that a side-varying call site uses takes the varying part as an
**optional argument defaulting to the old behaviour**, so the other side's call
sites do not change at all — see `buildBtbRemark(contact, adminName)`.

⚠️ **Ordering constraint.** `NAV_ITEMS` is filtered at module load from
`IS_ADMIN`, and these are plain `const`s in one flat script with no hoisting. Any
new side-varying constant must be declared **below** the side block
(`resolveSide` / `SIDE` / `IS_ADMIN` / `FEATURES`, roughly lines 500–570).

## Step 3 — a Dataverse column is TWO column names, transcribed not derived

Every Dataverse column name lives in `DATAVERSE_SCHEMAS`
(`PR Assistant App.html:6987`) and **nowhere else**. The only `admin_*` literals
allowed outside it are the web-resource names in `SIDE_BY_RESOURCE`.

**Never derive the admin name from the dev name.** There is no rule. A dozen
admin columns carry no suffix at all (`admin_vendor`, `admin_remarks`,
`admin_contractenddate`), one carries `24` (`admin_startx0020date24`), and the
two sides even disagree about column *count* — "No." and "PR No." share one
column on dev and are two columns on admin.

So for a new field, **ask the user for the real column name on each side it lands
on**. A guessed name makes Dataverse reject the whole create, not just that field.

Four maps per side, and a new field usually needs more than one:

| map | what it feeds | add here when… |
|---|---|---|
| `fields` | what the Verify Table reads back | the value is displayed on Verify |
| `select` | the OData `$select` | **every entry must also be in `fields` or `titleField`**, or the whole query fails |
| `write` | what the payload builders send | the value is saved |
| `records` | Master Records list (`$select` **and** each `item.<column>` read) | the value shows in Master Records |

Keys are the app's **own field key**, never the other side's column name. A field
key with no column on this side is dropped by `mapPayload`
(`PR Assistant App.html:7477`) — deliberate, not a nicety.

## Step 4 — the per-change checklists

Apply only the ones the change actually touches.

**Adding a page or a nav step**
- add to `NAV_ITEMS_ALL` (`:571`), with `devOnly: true` for a dev-only step;
  `NAV_ITEMS` (`:591`) is already the filtered list — **do not filter again** at
  a call site, or the rail and the step counter will disagree
- any `setPage("x")` jump must be guarded `if (navReachable("x"))` (`:598`)

**Adding or changing text size**
- a size that differs between sides needs a `fs-<dev>-<admin>` token whose name
  states both values; the admin value must be the larger
- the token must **not** sit beside a Tailwind size class on the same element —
  Tailwind is injected later and silently wins
- never write a size as bare `text-xs` or a raw `clamp()` in shared markup; only
  `text-[Npx]` and the tokens are swept for parity

**Touching OCR / parsing**
- do not run OCR before a document has a role assigned — that is the whole point
  of `deferOcr`
- a `parseFile` call that OCRs eagerly must pass `ocrBudgetMs`
- do not change what a **two-argument** `parseFile` returns; `Docparse/index.html`
  is a separate consumer. Every new engine parameter is optional and defaults to
  the old behaviour
- container-level aggregation stays in `Docparse/docparse-engine.js`, never moves
  into the App

**Touching Save**
- new payload logic goes inside `buildRecordPayload` (pure, testable), not inline
  in `goSave`
- the Save loop stays sequential — no `Promise.all`, no rollback-on-failure

## Step 5 — finish the change

Both of these, every time, without being asked:

**1. Bump `APP_VERSION`** (`PR Assistant App.html:675`) — exactly one segment,
reset everything to its right:
- **MAJOR** — a redesign, or reshaping how an existing page/flow works
- **MINOR** — a new column, field, section or page; capability added
- **PATCH** — behaviour was wrong and is now right

One bump per **logical change**, not per file edit.

**2. Run the tests the change touches**, from the repo root:

```
node _test/app-harness/side-schema.test.js   # ALWAYS: any side / schema / nav / font change
node _test/app-harness/render.test.js        # any component or markup change
node _test/app-harness/save.test.js          # buildRecordPayload
node _test/app-harness/master-records.test.js
node _test/app-harness/extracted-fields.test.js
node _test/app-harness/crosscheck.test.js
```

`side-schema.test.js` is the one that catches a wrong side: it asserts no entity
name appears on both sides, that every `select` entry is a real `fields` /
`titleField` column, the dev/admin entity counts (5 / 4), and every font token's
two rules against its own name.

Report the test output honestly — a failing test is reported as failing, not
worked around.

## What this skill will NOT do

- edit `PR Assistant App_Admin.html` (pre-merge original, test fixture only)
- guess a Dataverse column name
- proceed on an unstated side
- merge, rebase or force-push between `origin/main` and
  `feature/deferred-ocr-process-verify-flow` — the two lines are deliberately
  unreconciled; see `CLAUDE.md`

## Where the reasoning lives

`CLAUDE.md` at the repo root is the long-form record of *why* each rule exists,
each written after the mistake it prevents. Read the relevant section before
arguing with a rule here.
