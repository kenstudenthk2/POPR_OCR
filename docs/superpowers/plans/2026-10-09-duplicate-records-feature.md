# Duplicate Records Feature Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the "Duplicate" record feature in `Master page_21-Sep-2026.html` allowing users to create 1-10 copies of records with sequential Sub Numbers, parent-child relationship tracking, and full table/modal/navigation integration.

**Architecture:** Extend the `IRecord` schema and column configuration with `SubNumber`, `ParentRecordId`, `IsSubRecord`, and `IsParentRecord`. Add a Duplicate action button and a validated quantity modal. Implement duplication logic that clones all record state with unique internal system IDs and collision-safe sub-numbering. Add a Sub Record navigation bar at the top of the detail modal navigation tabs showing child counts and clickable navigation cards.

**Tech Stack:** Vanilla JavaScript (ES6+), HTML5, Tailwind CSS, XLSX-JS-Style. Node.js unit test harness using JSDOM/Node VM.

**Spec:** User prompt specifications for Duplicate feature in `Master page_21-Sep-2026.html`.

## Global Constraints

- File targeted: `Master page_21-Sep-2026.html`.
- Original record Sub Number must remain blank; sub-records are numbered sequentially (`Sub1`, `Sub2`, ... `SubN`).
- Sub Number must be unique within the same parent Record ID; never regenerate existing Sub Numbers.
- Quantity allowed: integers 1 to 10 only (reject letters, special characters, decimals, negatives, or > 10).
- Duplicate button placed in Record Detail Modal Footer next to "Verify".
- Visible Record ID (`Title`) remains unchanged across duplicates; each duplicate receives a unique internal system `Id`.
- Preserve all existing functionality, workflow stages, business rules, column preferences, and styling.

## Review Focus

1. **Sub Number Collision on Subsequent Duplications:** If parent has existing sub-records `Sub1` and `Sub2`, creating 2 more must yield `Sub3` and `Sub4`, not overwriting `Sub1` or `Sub2`.
2. **Duplicating from a Sub-Record:** If a user duplicates while currently viewing `Sub1`, the new sub-records must link to the original parent record ID and continue sequential numbering (`Sub3`, `Sub4`), keeping parent-child hierarchy intact.
3. **Quantity Modal Input Validation:** Rejecting invalid inputs like `"0"`, `"11"`, `"-1"`, `"2.5"`, `"abc"`, `""` and preventing duplication until a valid integer in `[1, 10]` is provided.
4. **Data Model Integrity:** Duplicated records must copy all properties (Request Info, Quotation Info, Contract Info, PR Info, PO Info, remarks, urgent flag, workflow status) while clearing Dataverse entity IDs (`dataverseId`, `_dvId`) to prevent accidental overwrites of the parent record.
5. **Table View and Export Parity:** `SubNumber` column appears directly after Record ID (`Title`) in the main table, Excel view, CSV export, and XLSX export, supporting search and sorting.

---

### Task 1: Comprehensive Test Suite for Duplicate Feature

**Files:**
- Create: `_test/app-harness/master-page-duplicate.test.js`

**Interfaces:**
- Consumes: `Master page_21-Sep-2026.html`
- Produces: Node.js test script asserting all functional requirements:
  - `SubNumber` in `COLUMN_CONFIG` after `Title`
  - `edit-subnumber` input field in HTML and mapped in `FIELD_ID_TO_RECORD_KEY`
  - `duplicateModal` and `#btn-duplicate` footer button
  - `duplicateRecord(sourceRecordId, quantity)` function behavior
  - `getSubRecords(parentRecordId)` function behavior
  - `renderSubRecordsTab()` and `#subRecordsBar` UI
  - Quantity validation (1-10)
  - Collision-free sequential sub-numbering

- [ ] **Step 1: Write the test file `_test/app-harness/master-page-duplicate.test.js`**

Create test script evaluating the HTML, parsing DOM elements, and running JS functions in a VM sandbox matching existing `master-page-*.test.js` conventions.

- [ ] **Step 2: Run the test to verify it fails on missing features**

Run: `node _test/app-harness/master-page-duplicate.test.js`
Expected: FAIL (missing DOM elements and functions)

- [ ] **Step 3: Commit test file**

```bash
git add _test/app-harness/master-page-duplicate.test.js
```

---

### Task 2: Data Model, Column Configuration, and Form Field Integration

**Files:**
- Modify: `Master page_21-Sep-2026.html`

**Interfaces:**
- Consumes: `IRecord` type definitions, `COLUMN_CONFIG`, `FIELD_ID_TO_RECORD_KEY`, `PERMANENTLY_DISABLED_FIELD_IDS`
- Produces:
  - `SubNumber` column in `COLUMN_CONFIG` after `Title`
  - `SubNumber?: string; ParentRecordId?: string; IsSubRecord?: boolean; IsParentRecord?: boolean;` in `IRecord`
  - `#edit-subnumber` disabled text input in Request Information card beside Request ID
  - `'edit-subnumber': 'SubNumber'` in `FIELD_ID_TO_RECORD_KEY`
  - `'edit-subnumber'` in `PERMANENTLY_DISABLED_FIELD_IDS`
  - Table cell rendering for `SubNumber`

- [ ] **Step 1: Add `SubNumber` to `IRecord` JSDoc and `COLUMN_CONFIG` directly after `Title`**

In `COLUMN_CONFIG`:
```javascript
{ key: "Title", label: "Record ID", visible: true, sortable: true },
{ key: "SubNumber", label: "Sub Number", visible: true, sortable: true },
```

- [ ] **Step 2: Add `#edit-subnumber` input to HTML in `tab-request`**

Insert the Sub Number field next to Request ID in the Request Information card:
```html
<div class="flex flex-col gap-1.5">
    <label class="text-[12px] font-semibold text-[var(--muted)]">Sub Number</label>
    <input type="text" id="edit-subnumber" disabled class="field-control w-full px-3.5 py-2 text-[14px] text-[var(--muted)] bg-[var(--surface-soft)] rounded-lg border-[1.5px] border-[var(--line)]">
</div>
```

- [ ] **Step 3: Map `'edit-subnumber': 'SubNumber'` in `FIELD_ID_TO_RECORD_KEY` and add to `PERMANENTLY_DISABLED_FIELD_IDS`**

Ensure `edit-subnumber` is always disabled and properly loaded in `openEditModal()`.

- [ ] **Step 4: Update table row rendering in `renderTable` for `SubNumber`**

Add case for `SubNumber` in `renderTable` to render monospace clean text.

---

### Task 3: Duplicate Button and Quantity Modal UI

**Files:**
- Modify: `Master page_21-Sep-2026.html`

**Interfaces:**
- Consumes: `#action-buttons`, modal styles
- Produces:
  - Duplicate button `#btn-duplicate` in modal footer beside `Verify`
  - `#duplicateModal` with title, message, number input (`min="1" max="10"`), error container, Cancel and Confirm buttons
  - `openDuplicateModal()`
  - `closeDuplicateModal()`
  - `confirmDuplicateRecord()` with strict validation (1-10 whole numbers only)

- [ ] **Step 1: Add `#btn-duplicate` to Record Detail Modal footer `#action-buttons`**

Place right before `Verify`:
```html
<button type="button" onclick="openDuplicateModal()" id="btn-duplicate" class="ui-transition pressable min-h-[42px] px-5 py-2 rounded-lg text-[14px] font-bold border-[1.5px] border-[#B8B8BD] bg-white text-[var(--ink)] hover:bg-[#FFF3D6] hover:border-[var(--orange-dark)]">Duplicate</button>
```

- [ ] **Step 2: Add `#duplicateModal` markup to the HTML**

Create the modal dialog matching existing confirmation modals:
- Title: "Duplicate Record"
- Content: "How many sub-records would you like to create?"
- Input: `<input type="number" id="duplicate-quantity" min="1" max="10" step="1" value="1" ...>`
- Error: `<span id="duplicate-error" class="hidden text-[12px] font-medium text-[var(--red)]">...</span>`
- Action buttons: Cancel and Confirm

- [ ] **Step 3: Implement modal control and validation functions in script**

Implement:
- `openDuplicateModal()`: reset quantity to `1`, clear error, open modal, focus input.
- `closeDuplicateModal()`: hide modal.
- `confirmDuplicateRecord()`: validate quantity:
  - Regex `/^\d+$/`
  - Range `qty >= 1 && qty <= 10`
  - Show error if invalid
  - If valid, close modal and call `duplicateRecord(state.currentRecord.Id, qty)`

---

### Task 4: Duplication Engine and Parent-Child Relationship Logic

**Files:**
- Modify: `Master page_21-Sep-2026.html`

**Interfaces:**
- Consumes: `state.allData`, `state.currentRecord`
- Produces:
  - `getNextUniqueRecordId(): string`
  - `getSubRecords(parentRecordId: string): IRecord[]`
  - `duplicateRecord(sourceRecordId: string, quantity: number): IRecord[]`

- [ ] **Step 1: Implement `getNextUniqueRecordId()`**

Find highest numeric ID among records and iterate until unused, ensuring unique internal system IDs.

- [ ] **Step 2: Implement `getSubRecords(parentRecordId)`**

Find all records in `state.allData` where `IsSubRecord === true` and `ParentRecordId === String(parentRecordId)` (or matching parent title). Return them sorted naturally by `SubNumber` (`Sub1`, `Sub2`, ...).

- [ ] **Step 3: Implement `duplicateRecord(sourceRecordId, quantity)`**

- Resolve parent ID (if source is already a sub-record, use `source.ParentRecordId`; otherwise `source.Id`).
- Mark parent with `IsParentRecord = true`.
- Determine existing sub-numbers to find max sub-number index.
- Clone all properties from `sourceRecord`.
- Strip Dataverse IDs (`dataverseId`, `_dvId`) from cloned records.
- Set `Id = getNextUniqueRecordId()`, `Title = source.Title`, `SubNumber = 'Sub' + nextNum`, `ParentRecordId = parentId`, `IsSubRecord = true`, `IsParentRecord = false`.
- Append to `state.allData`.
- Call `applyFilters()`, `updateDashboard()`, `renderSubRecordsTab()`, and `showToast()`.
- Return created records.

- [ ] **Step 4: Protect Dataverse save from overwriting parent record on sub-records**

In `persistRecordToDataverse(record)`:
Ensure that if `record.IsSubRecord` is true and `!record.dataverseId`, it does not query Dataverse by `admin_title eq '${title}'` which would match the parent record.

---

### Task 5: Sub Record Tab UI and Navigation Integration

**Files:**
- Modify: `Master page_21-Sep-2026.html`

**Interfaces:**
- Consumes: `getSubRecords()`, `openEditModal()`
- Produces:
  - Container `#subRecordsBar` above modal tab buttons
  - `renderSubRecordsTab()` function
  - Clickable sub-record cards/buttons
  - Active record visual highlighting

- [ ] **Step 1: Add `#subRecordsBar` container to the top of the modal navigation bar**

Add `#subRecordsBar` right above the navigation tabs and Urgent Case toggle row.

- [ ] **Step 2: Implement `renderSubRecordsTab()`**

- Determine parent record and sub-records via `getSubRecords()`.
- Render counter `Sub Records (N):`.
- If sub-records exist, render `Main` button and cards for each sub-record: `[Sub1] [Sub2] ...`.
- Highlight active card corresponding to `state.currentRecord.Id`.
- Wire `onclick="openEditModal('...')"` to navigate to the clicked record.

- [ ] **Step 3: Call `renderSubRecordsTab()` inside `openEditModal()`**

Ensure the Sub Records bar updates whenever a record is opened.

---

### Task 6: Verification and Regression Testing

**Files:**
- Test: `_test/app-harness/master-page-duplicate.test.js`
- Test: all `_test/app-harness/master-page-*.test.js`

- [ ] **Step 1: Run the new duplicate feature tests**

Run: `node _test/app-harness/master-page-duplicate.test.js`
Expected: ALL CHECKS PASSED.

- [ ] **Step 2: Run all existing master-page tests to confirm zero regressions**

Run: `node -e "const fs = require('fs'); const { execSync } = require('child_process'); const files = fs.readdirSync('_test/app-harness').filter(f => f.startsWith('master-page-') && f.endsWith('.test.js')); for (const f of files) { console.log('Running ' + f); execSync('node _test/app-harness/' + f, { stdio: 'inherit' }); }"`
Expected: ALL CHECKS PASSED across all suites.
