# PR Assistant Upload Page PRPO Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the first route of `PR Assistant App.html` visually match `PRPO.html` without changing its working upload, parsing, field-review, remark, viewer, or navigation behavior.

**Architecture:** Keep the existing single-file React application and treat `PRPO.html` as a visual reference only. Recompose the existing `UploadPage` JSX into the reference page's two-column card layout, retain every state variable and handler, and scope any shared-component variation to the upload route.

**Tech Stack:** HTML, React 18 UMD, ReactDOM 18 UMD, Babel standalone JSX, Tailwind CSS CDN, Docparse browser libraries, Node-based render harness, browser visual inspection.

## Global Constraints

- Change application code only in `PR Assistant App.html`.
- Preserve the build-free, install-free, zip-distributable, `file://`-openable architecture.
- Do not add ES modules, a bundler, or an npm dependency to the shipping app.
- Do not copy mock record values from `PRPO.html` into application state.
- Preserve existing parser calls, callbacks, field data, conditional states, and route transitions.
- Leave Processing, Extracted Fields, Verify, Master Records, Reply, and Document Viewer unchanged.
- Do not read, quote, copy, stage, or commit values from the commercial corpus or ignored `_test/` fixtures.
- Stage files explicitly; the working tree contains unrelated user changes and ignored commercial/test data.

## File Structure

- Modify: `PR Assistant App.html` — the shipping single-file application; only the `UploadPage` render structure and route-scoped presentation may change.
- Reference only: `PRPO.html` — static Tailwind visual source of truth; never import or embed it.
- Reference only: `_test/app-harness/render.test.js` — existing ignored render smoke test; run it without editing or committing it.
- Reference only: `_test/app-harness/crosscheck.test.js` and `_test/app-harness/outlook-drop.test.js` — existing behavior checks; run them without editing or committing them.

---

### Task 1: Establish the behavior baseline and visual contract

**Files:**
- Inspect: `PRPO.html`
- Inspect: `PR Assistant App.html:2037-2150`
- Inspect: `PR Assistant App.html:3053-3542`
- Test: `_test/app-harness/render.test.js`
- Test: `_test/app-harness/crosscheck.test.js`
- Test: `_test/app-harness/outlook-drop.test.js`

**Interfaces:**
- Consumes: `UploadPage(props)`, `TopBar({ title, desc, right })`, `Sidebar({ page, setPage, currentRecord, progress, onNewRecord })`, `Card({ children, className })`, and the existing upload-page callback props.
- Produces: a recorded green baseline and a concrete mapping from each PRPO visual section to an existing live component or handler.

- [ ] **Step 1: Run the render baseline**

Run:

```powershell
rtk proxy node _test/app-harness/render.test.js
```

Expected: the script exits zero and reports zero failures.

- [ ] **Step 2: Run the cross-document behavior baseline**

Run:

```powershell
rtk proxy node _test/app-harness/crosscheck.test.js
```

Expected: the script exits zero and reports zero failures.

- [ ] **Step 3: Run the upload/drop behavior baseline**

Run:

```powershell
rtk proxy node _test/app-harness/outlook-drop.test.js
```

Expected: the script exits zero and reports zero failures.

- [ ] **Step 4: Record the section-to-handler contract before moving JSX**

Use this exact mapping during the edit:

```text
Top-bar attachment count -> parsedCount
Top-bar Demo control -> toggleDemo / demoMode
Top-bar Process action -> goProcess
Attachment chips -> ATTACHMENT_TYPES / activeTab / setActiveTab / setItemIndex
Hidden file input and dropzone -> fileInputRef / handleUpload / collectDroppedFiles
Parsing feedback -> parsingTab / statusMsg / statusPct / uploadError
Extracted fields -> renderField / fields / crosschecks / setField
Role controls -> RoleSlotBar / RoleAssignmentEditor / saveRoles
ATQ item chips -> itemIndex / selectItem
Excel copy -> copyForExcel / copied
Supplier remark -> selectSupplierOption / supplierRemarkText / copySupplierRemark
Buyer remark -> selectSalesContact / btbRemarkText / copyBtbRemark
Right rail -> AttachmentStatusCard / EmailDocumentsCard / reDetectFields
```

No commit is required because this task changes no files.

---

### Task 2: Recompose UploadPage into the PRPO layout

**Files:**
- Modify: `PR Assistant App.html:3238-3538`
- Test: `_test/app-harness/render.test.js`
- Test: `_test/app-harness/crosscheck.test.js`
- Test: `_test/app-harness/outlook-drop.test.js`

**Interfaces:**
- Consumes: every state value and handler listed in Task 1.
- Produces: the same `UploadPage(props)` interface with PRPO-matching structure, responsive width behavior, and unchanged callbacks.

- [ ] **Step 1: Preserve the top bar and bind its live actions**

Keep the top bar call connected exactly as follows; change only route-scoped presentation classes if the reference requires them:

```jsx
<TopBar
  title="Upload & Parse"
  desc="Drop attachments to auto-extract PR fields. PDFs read directly; scanned files use OCR."
  right={
    <React.Fragment>
      <Pill className="bg-[#E8F5EC] text-[#3D8B5F]">{parsedCount}/5 attachments</Pill>
      <GhostButton onClick={toggleDemo} className={demoMode ? "!border-[#D4916E] !text-[#D4916E]" : ""}>
        {demoMode ? "✓ Demo" : "Demo"}
      </GhostButton>
      <PrimaryButton onClick={goProcess}>Process →</PrimaryButton>
    </React.Fragment>
  }
/>
```

- [ ] **Step 2: Build the responsive PRPO content frame**

Replace the fixed two-column wrapper with a route-scoped responsive frame that is two columns at the reference width and stacked on smaller screens:

```jsx
<div className="flex flex-col xl:flex-row gap-6 px-8 pb-8 items-start">
  <main className="w-full min-w-0 flex-1 flex flex-col gap-5">
  <aside className="w-full xl:w-[280px] xl:shrink-0 flex flex-col gap-4">
</div>
```

Use the first opening tag before the attachment card and close `main` after the remark panels. Open `aside` before `AttachmentStatusCard`, close it after the verification warning, then close the outer frame.

- [ ] **Step 3: Match the PRPO attachment controls and dropzone**

Keep the hidden input as a sibling of the visible dropzone. Use the reference card, chip, border, type, and spacing vocabulary:

```jsx
<Card className="p-5 flex flex-col gap-3.5">
  <div className="text-xs font-bold tracking-[1px] text-[#3D3D3D]">ATTACHMENT TYPE</div>
  <div className="flex gap-2 flex-wrap">
    {ATTACHMENT_TYPES.map(t => {
      const active = t === activeTab;
      const done = attachments[t].parsed;
      return (
        <button key={t} onClick={() => { setActiveTab(t); setItemIndex(0); }}
          className={`flex items-center gap-[7px] px-3.5 py-2 rounded-full border-[1.5px] transition ${active ? "bg-[#FBF0E8] border-[#D4916E]" : "bg-[#F3EBE2] border-[#C5BEB6]"}`}>
          <span className={`w-2 h-2 rounded-full ${done ? "bg-[#3D8B5F]" : "bg-[#C5BEB6]"}`} />
          <span className={`text-xs font-semibold ${active ? "text-[#D4916E]" : "text-[#6B6B6B]"}`}>{t}</span>
        </button>
      );
    })}
  </div>
</Card>

<div
  onClick={() => fileInputRef.current && fileInputRef.current.click()}
  onDragOver={e => { e.preventDefault(); setDragOver(true); }}
  onDragLeave={() => setDragOver(false)}
  onDrop={e => {
    e.preventDefault();
    setDragOver(false);
    const drop = collectDroppedFiles(e.dataTransfer);
    drop.files.then(files => {
      if (files.length) { setUploadError(""); handleUpload(files[0]); return; }
      setUploadError(drop.emptyMessage);
    });
  }}
  className={`w-full flex flex-col gap-2 py-10 px-5 items-center bg-[#FBF0E8] border-2 rounded-xl cursor-pointer transition ${dragOver ? "border-[#C47F5B]" : "border-[#D4916E]"} ${parsingTab === activeTab ? "opacity-70 pointer-events-none" : "hover:brightness-[0.98]"}`}
>
</div>
```

Inside the dropzone, keep the current icon, parsing/upload message expression, format help, Outlook help, and `statusPct` progress condition in their current order.

- [ ] **Step 4: Match the PRPO extracted-fields card**

Keep one card with this order: title row, `RoleSlotBar`, auto-extracted legend, Excel-copy action, capsule legend, conditional `RoleAssignmentEditor`, conditional item chips, lead fields, and the three-column field grid. Preserve these calls:

```jsx
<RoleSlotBar census={census} onOpen={openSource} onEdit={() => setEditingRoles(true)} />
<GhostButton onClick={copyForExcel} title="Copy all fields, tab-separated in Excel column order (A-Y)">
  {copied ? "✓ Copied" : "⧉ Copy for Excel"}
</GhostButton>
{LEAD_FIELD_DEFS.map(d => renderField(d, d[0] === "recordNo" ? "w-20" : "w-36"))}
{Array.from({ length: Math.ceil(GRID_FIELD_DEFS.length / 3) }, (_, i) =>
  GRID_FIELD_DEFS.slice(i * 3, i * 3 + 3)
).map((row, i) => (
  <div key={i} className="flex flex-col md:flex-row gap-3.5">
    {row.map(d => renderField(d))}
  </div>
))}
```

The responsive row class may change presentation only; it must not change field order or keys.

- [ ] **Step 5: Match the PRPO remark card**

Keep the supplier and buyer panels in one responsive row and preserve their controlled inputs:

```jsx
<div className="flex flex-col lg:flex-row gap-5 items-start">
  <Card className="w-full lg:flex-1 p-6 flex flex-col gap-4">
    <textarea value={supplierRemarkText} onChange={e => setSupplierRemarkText(e.target.value)} rows={11} />
  </Card>
  <Card className="w-full lg:flex-1 p-6 flex flex-col gap-4">
    <select value={salesContactKey} onChange={e => selectSalesContact(e.target.value)} />
    <textarea value={btbRemarkText} onChange={e => setBtbRemarkText(e.target.value)} rows={11} />
  </Card>
</div>
```

Keep both copy buttons, full textarea classes, option lists, row counts, and placeholder strings from the current implementation. The abbreviated tags above specify the state bindings that must remain exact; they do not replace the complete controls.

- [ ] **Step 6: Match the PRPO supporting rail**

Keep the rail in this exact functional order:

```jsx
<AttachmentStatusCard attachments={attachments} onOpen={openViewer} />
<EmailDocumentsCard entry={attachments[activeTab]} typeKey={activeTab} onOpen={openViewer} />
{attachments[activeTab].text || "(no file parsed yet)"}
<button onClick={reDetectFields} disabled={!attachments[activeTab].rawFields}>Re-detect fields</button>
<div>Fields turn white once edited. Green = auto-extracted — always verify before proceeding.</div>
```

Keep the text fallback and disabled guard inside their current styled card and warning containers; change only the containers' route-scoped presentation classes.

- [ ] **Step 7: Run the behavior checks after recomposition**

Run:

```powershell
rtk proxy node _test/app-harness/render.test.js
rtk proxy node _test/app-harness/crosscheck.test.js
rtk proxy node _test/app-harness/outlook-drop.test.js
```

Expected: all three scripts exit zero with zero failures. A JSX syntax error, missing prop, missing label, or broken upload handler fails this step.

- [ ] **Step 8: Review the application diff for scope**

Run:

```powershell
rtk proxy git diff -- "PR Assistant App.html"
```

Expected: changes stay within the first-page render path or route-scoped presentation; no parser, comparison, saving, later-page, or viewer logic changes.

- [ ] **Step 9: Commit the functional layout change**

Run:

```powershell
rtk proxy git add -- "PR Assistant App.html"
rtk proxy git commit -m "Restyle the upload page from PRPO"
```

Expected: the commit contains only `PR Assistant App.html`.

---

### Task 3: Verify visual fidelity and route isolation

**Files:**
- Modify if required: `PR Assistant App.html:3238-3538`
- Reference: `PRPO.html`
- Test: `_test/app-harness/render.test.js`

**Interfaces:**
- Consumes: the Task 2 `UploadPage(props)` implementation.
- Produces: visual evidence at the 1440-pixel reference width, interaction evidence for the first page, and smoke evidence that later routes remain intact.

- [ ] **Step 1: Serve the repository without changing application paths**

Run from the repository root:

```powershell
rtk proxy python -m http.server 8765 --bind 127.0.0.1
```

Expected: `http://127.0.0.1:8765/PRPO.html` and `http://127.0.0.1:8765/PR%20Assistant%20App.html` return HTML. HTTP is only for repeatable browser inspection; the implementation must remain `file://` compatible.

- [ ] **Step 2: Capture the reference and implementation at 1440 pixels**

Open both URLs in a browser with a 1440-pixel-wide viewport. Capture full-page screenshots. Compare:

```text
sidebar width and ink background
top-bar title, subtitle, and action alignment
primary/supporting column widths and 24px gutter
white card order, padding, radii, and shadows
attachment chips and terracotta dropzone
extracted-field title row and grid density
two remark panels
right-rail card order and 280px width
```

Expected: the application follows the same hierarchy, proportions, palette, type roles, and spacing as `PRPO.html`; only live content and responsive behavior differ.

- [ ] **Step 3: Exercise the first-page controls**

Verify in the browser:

```text
each attachment chip becomes active when clicked
the Demo control toggles the live demo state
the hidden file picker opens from the dropzone
editable fields accept input
role and item controls remain reachable when their conditions are present
remark selections update their controlled textareas
document links open Document Viewer when a document exists
Process advances to Processing or Extracted Fields through the existing flow
New Record returns to the empty Upload & Parse state
```

Expected: no console errors and no control loses its existing action.

- [ ] **Step 4: Smoke-test later routes**

Use the sidebar or existing transitions to render Verify, Master Records, and Reply. Confirm their component structure and shell presentation did not change.

Expected: later routes render without console errors or upload-page-only layout wrappers.

- [ ] **Step 5: Correct visual discrepancies within scope**

If the comparison exposes a mismatch, change only Tailwind classes or route-scoped upload markup in `PR Assistant App.html`. Do not change state, callbacks, parsing, saving, comparison rules, later pages, or viewer code.

- [ ] **Step 6: Re-run the render test and inspect the final diff**

Run:

```powershell
rtk proxy node _test/app-harness/render.test.js
rtk proxy git diff HEAD -- "PR Assistant App.html"
```

Expected: the render test exits zero. Any post-Task-2 diff contains only visual corrections within `UploadPage`.

- [ ] **Step 7: Commit visual corrections if any exist**

Run only when Step 5 changed the file:

```powershell
rtk proxy git add -- "PR Assistant App.html"
rtk proxy git commit -m "Polish PRPO upload-page fidelity"
```

Expected: the commit contains only `PR Assistant App.html`. If Step 5 required no correction, skip this commit.

---

### Task 4: Final completion audit

**Files:**
- Verify: `PR Assistant App.html`
- Reference: `PRPO.html`
- Reference: `docs/superpowers/specs/2026-08-15-pr-assistant-upload-page-prpo-integration-design.md`

**Interfaces:**
- Consumes: the completed upload-page implementation and all verification evidence.
- Produces: a requirement-by-requirement completion report.

- [ ] **Step 1: Run the complete non-browser verification set**

Run:

```powershell
rtk proxy node _test/app-harness/render.test.js
rtk proxy node _test/app-harness/crosscheck.test.js
rtk proxy node _test/app-harness/outlook-drop.test.js
```

Expected: all scripts exit zero with zero failures.

- [ ] **Step 2: Confirm the commit and worktree scope**

Run:

```powershell
rtk proxy git show --stat --oneline HEAD
rtk proxy git status --short
```

Expected: implementation commits contain only `PR Assistant App.html`. Pre-existing unrelated modifications and untracked files remain untouched.

- [ ] **Step 3: Audit every design requirement against evidence**

Record PASS evidence for:

```text
PRPO-matching first-page structure at 1440px
live data instead of reference mock values
working attachment, upload, parsing, field, role, item, remark, viewer, Process, and New Record flows
preserved error, progress, empty, and disabled states
unchanged later routes
build-free and file://-safe application structure
responsive behavior below the reference width
```

Do not mark the goal complete if any item lacks direct test, source, or rendered-browser evidence.
