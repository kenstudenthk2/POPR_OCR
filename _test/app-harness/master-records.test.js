/* master-records.test.js -- the Master Records page
   -------------------------------------------------
   Reads "PR Assistant App.html", same as every other test here. It used to
   read a separate "PR Assistant App_MasterRecords.html"; that file was folded
   into the app so there is one script and one version number, and this test
   followed it in. It still does NOT use app-harness/app.js -- that loader's
   EXPORTS list does not carry this page's symbols and this file needs a
   localStorage stub app.js has no reason to provide. Same mechanics though:
   read the HTML as text, pull the
   <script type="text/babel-jsx"> block out, compile it with @babel/standalone,
   run it in a Node vm, then render the real components with
   renderToStaticMarkup.

   What it pins is the logic ported from the plain-HTML reference screen
   (the "gemini" prototype), because none of it is visible to `ab-diff` and
   most of it is the kind of thing a browser eyeball cannot check reliably:

     - the approval THRESHOLD matrix, including the exclusive ".99" boundaries.
       "> 499999.99" and ">= 500000" differ for any amount carrying cents, and
       a wrong band silently routes a PR to the wrong approver -- which looks
       exactly like a right one on screen.
     - that an amount below every threshold makes the workflow SKIP the
       approval stage rather than stall on it forever, in the state machine AND
       in the stage ladder the stepper draws.
     - that the table's Workflow Status pill and the Manage modal agree, which
       only holds because masterRecordWorkflowStep hands btbType/hkd down.
     - that a cancelled record locks (Save disabled, no "Record Cancel", a
       cancellation banner, a Re-open button instead).
     - that every field in the Manage modal's editable grid has a real
       Dataverse column behind it, in BOTH halves: a kind in
       MASTER_RECORDS_EDITABLE_FIELDS, and a column under the same key in
       SCHEMA.lis.records. saveAllPendingChanges skips a key missing either
       one SILENTLY, so an unmapped field is a box a reviewer can type into
       that discards their work with no error -- this check is what caught
       statusRemark being unmapped. The second half also stands in for the
       transcription that used to live in this page's own file: two of its
       column names had been truncated, and Dataverse rejects the WHOLE
       update on one unknown column, so those two cost a reviewer every
       other field they had typed in the same Save.

   Run: node _test/app-harness/master-records.test.js
*/
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const Babel = require("@babel/standalone");
const React = require("react");
const ReactDOMServer = require("react-dom/server");

const REPO = path.resolve(__dirname, "..", "..");
const HTML_PATH = process.argv[2] || path.join(REPO, "PR Assistant App.html");
const HTML = fs.readFileSync(HTML_PATH, "utf8");

const m = HTML.match(/<script type="text\/babel-jsx" id="app-src">([\s\S]*?)<\/script>/);
if (!m) { console.error("FAIL: could not find the app-src block in " + HTML_PATH); process.exit(1); }

// The bootstrap render is stripped so the components can be driven directly;
// there is no DOM here for createRoot to attach to.
let src = m[1].replace(/ReactDOM\.createRoot\([\s\S]*$/, "");

let code;
try {
  code = Babel.transform(src, { presets: [["react", { runtime: "classic" }]] }).code;
} catch (e) {
  console.error("FAIL: Babel could not compile the JSX block:\n" + e.message);
  process.exit(1);
}
console.log("OK   Babel compiled the JSX block (" + code.length + " bytes)");

// Just enough of a browser for the module body and a static render. Nothing
// here needs parent.Xrm.WebApi: the components take their writes as props, so
// the Dataverse side is stubbed by the callers below, exactly as this repo's
// own CLAUDE.md says the real create/update loops can only be confirmed in the
// model-driven app.
const store = {};
const sandbox = {
  React,
  ReactDOM: { createRoot: () => ({ render() {} }) },
  console,
  XLSX: undefined,
  setTimeout, clearTimeout,
  window: {
    localStorage: {
      getItem: k => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
    },
    addEventListener() {}, removeEventListener() {},
    confirm: () => true,
    alert() {},
  },
  document: { getElementById: () => ({ textContent: "" }) },
  parent: {},
  URL: { createObjectURL: () => "blob:x" },
  // resolveSide/resolveMode read ?side= / ?mode= through this. Real in Node,
  // same as in every browser -- without it they throw rather than answering.
  URLSearchParams,
  EXPORTS: {},
};
sandbox.globalThis = sandbox;

// A list, not a re-export block in the file itself -- same reason
// app-harness/app.js keeps its own EXPORTS list: the HTML must stay a plain
// browser file with no module syntax in it.
const NAMES = ["getDualApprovers", "evaluateManageWorkflowState", "workflowStepsFor",
  "masterRecordWorkflowStep", "masterRecordApprover", "matchesWorkflowTab",
  "quotationExpiryInfo", "getCurrentHKTDate", "formatPrAmountDisplay",
  "MANAGE_WORKFLOW_STEPS", "MANAGE_WORKFLOW_CANCELLED", "WORKFLOW_TABS",
  "MASTER_RECORDS_COLUMNS", "MANAGE_GRID_EXCLUDED_KEYS", "MASTER_RECORDS_EDITABLE_FIELDS",
  "DEMO_RECORDS", "RecordsPage", "MasterRecordDetailModal", "APP_VERSION",
  // The page's columns now come from the app's own per-side schema instead of
  // a second copy of every name kept beside it -- so the schema is what the
  // "has a Dataverse column" check below has to ask.
  "SCHEMA", "MODE_BY_RESOURCE", "resolveMode"];
code += "\n;" + NAMES.map(n => `try { EXPORTS.${n} = ${n}; } catch (e) {}`).join("\n");

try {
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: "app-src.js" });
} catch (e) {
  console.error("FAIL: module body threw at load time:\n" + e.stack);
  process.exit(1);
}
console.log("OK   module body evaluated");

const X = sandbox.EXPORTS;
let failures = 0;
const eq = (label, actual, expected) => {
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  if (a === b) { console.log("OK   " + label); }
  else { console.error("FAIL " + label + "\n       expected " + b + "\n       actual   " + a); failures++; }
};

console.log("\n-- version --");
// One version for the whole app now. The page used to carry a counter of its
// own, which meant a reviewer on the Master Records web resource could not
// compare the number they saw against the one the rest of the team quoted.
eq("the page reports the app's own version, not one of its own",
  typeof X.APP_VERSION === "string" && /^\d+\.\d+\.\d+$/.test(X.APP_VERSION), true);
eq("no page-local version constant survives", X.MASTER_RECORDS_PAGE_VERSION, undefined);

console.log("\n-- which web resource opens on this page --");
// The admin_MasterRecords.html resource renders this page alone, with no
// workflow rail around it. Pinned with and without the .html and
// case-insensitively, for the same reason side-schema.test.js pins
// resolveSide: Dataverse serves the resource name as authored.
eq("admin_MasterRecords.html opens the records-only mode",
  X.resolveMode("/WebResources/admin_MasterRecords.html", ""), "records");
eq("...without the extension too",
  X.resolveMode("/webresources/ADMIN_MASTERRECORDS", ""), "records");
// A query string must not decide the page -- ?preview=1 is just how a
// reviewer happened to open it, not a different page.
eq("a query string does not change the answer",
  X.resolveMode("/WebResources/admin_MasterRecords.html", "?preview=1"), "records");
// Unlike an unknown SIDE, an unknown resource here falls through to the full
// app: the cost of a miss is the wrong PAGE, visible the instant it loads,
// not the wrong TABLE, which is silent and unrecoverable.
eq("the app's own resource still opens the full app",
  X.resolveMode("/WebResources/admin_PRAssistant.html", ""), "app");
eq("an unrecognised resource falls through to the full app",
  X.resolveMode("/WebResources/something_else", ""), "app");

console.log("\n-- approver threshold matrix --");
// The boundaries are stated as ".99" ceilings, so each band is pinned from
// BOTH sides: the round number just above it, and the ".99" figure itself,
// which must fall to the band BELOW.
const ap = (t, a) => X.getDualApprovers(t, a).approver;
eq("BTB 23,400,000 -> MD", ap("BTB", 23400000), "MD");
eq("BTB 23,399,999.99 -> SVP (the boundary is exclusive)", ap("BTB", 23399999.99), "SVP");
eq("BTB 2,000,000 -> SVP", ap("BTB", 2000000), "SVP");
eq("BTB 1,999,999.99 -> VP", ap("BTB", 1999999.99), "VP");
eq("BTB 1,000,000 -> VP", ap("BTB", 1000000), "VP");
eq("BTB 999,999.99 -> AVP", ap("BTB", 999999.99), "AVP");
eq("BTB 500,000 -> AVP", ap("BTB", 500000), "AVP");
eq("BTB 499,999.99 -> none", ap("BTB", 499999.99), "");
eq("NON-BTB 780,000 -> MD", ap("NON-BTB", 780000), "MD");
eq("NON-BTB 779,999.99 -> SVP", ap("NON-BTB", 779999.99), "SVP");
eq("NON-BTB 156,000 -> SVP", ap("NON-BTB", 156000), "SVP");
eq("NON-BTB 155,999.99 -> AVP or VP", ap("NON-BTB", 155999.99), "AVP or VP");
eq("NON-BTB 39,000 -> AVP or VP", ap("NON-BTB", 39000), "AVP or VP");
eq("NON-BTB 38,999.99 -> none", ap("NON-BTB", 38999.99), "");
// An unset BTB Type must not inherit BTB's much higher -- i.e. far more
// permissive -- bands by default. 39,000 needs an approver as NON-BTB and
// needs none as BTB, so this one value tells the two ladders apart.
eq("unset type uses the NON-BTB (stricter) ladder", ap("", 39000), "AVP or VP");
eq("...and BTB really would wave the same amount through", ap("BTB", 39000), "");
// The table hands over a display string with separators, the modal hands over
// a bare draft; both must land in the same band.
eq("comma-formatted string reads the same as a number", ap("NON-BTB", "156,000.00"), "SVP");
eq("the display em dash reads as 0, not as NaN", ap("NON-BTB", "—"), "");
eq("statusDisplay when no approver", X.getDualApprovers("BTB", 1).statusDisplay, "Not Required");
eq("statusDisplay names the approver", X.getDualApprovers("NON-BTB", 40000).statusDisplay,
  "Waiting PR Request Approval (AVP or VP)");

console.log("\n-- workflow state machine --");
const st = o => X.evaluateManageWorkflowState(o);
eq("cancelled wins over every other gate",
  st({ cancelled: true, prNo: "PR1", reviewDoc: {}, approvalDoc: {}, poNo: "PO1" }), "Cancelled");
eq("no PR No.", st({}), "Submit LIS System");
eq("PR but no review document", st({ prNo: "PR1" }), "Waiting UM Review");
eq("approver required and no approval document",
  st({ prNo: "PR1", reviewDoc: {}, btbType: "NON-BTB", prAmount: 40000 }), "Waiting PR Request Approval");
// The whole point of the matrix: a small amount is never asked for an approval
// document, so it does not stall on a stage nobody will action.
eq("no approver -> skips approval straight to PO",
  st({ prNo: "PR1", reviewDoc: {}, btbType: "NON-BTB", prAmount: 1000 }), "Input PO No.");
eq("no approver + PO -> Completed",
  st({ prNo: "PR1", reviewDoc: {}, poNo: "PO1", btbType: "NON-BTB", prAmount: 1000 }), "Completed");
eq("approver + approval + PO -> Completed",
  st({ prNo: "PR1", reviewDoc: {}, approvalDoc: {}, poNo: "PO1", btbType: "BTB", prAmount: 9e9 }), "Completed");
// btbType/prAmount are optional: an older two-key call must still answer, and
// must answer by SKIPPING the approval stage rather than demanding it.
eq("two-key legacy call still answers", st({ prNo: "PR1", reviewDoc: {} }), "Input PO No.");
eq("the display em dash is not a PR No.", st({ prNo: "—" }), "Submit LIS System");

console.log("\n-- the stage ladder is dynamic --");
eq("with an approver: 5 stages", X.workflowStepsFor(true).length, 5);
eq("without one: 4 stages, approval dropped",
  X.workflowStepsFor(false), ["Submit LIS System", "Waiting UM Review", "Input PO No.", "Completed"]);
// "Cancelled" is deliberately not a ladder member -- a cancelled record is off
// the ladder, not at a stage on it.
eq("Cancelled is not a ladder member", X.MANAGE_WORKFLOW_STEPS.includes(X.MANAGE_WORKFLOW_CANCELLED), false);

console.log("\n-- row-level helpers (the table's own pill) --");
const row = (o) => Object.assign({
  status: "Pending", prNo: "—", poNo: "—", reviewApprovalRaw: "",
  btbType: "", hkd: "—", quotationExpiryDate: "",
}, o);
eq("a row with nothing -> Submit LIS System", X.masterRecordWorkflowStep(row({})), "Submit LIS System");
eq("cancelled comes from the manual Status (new_prstatus)",
  X.masterRecordWorkflowStep(row({ status: "Cancel", prNo: "PR1" })), "Cancelled");
// These two are the pair that only pass because masterRecordWorkflowStep hands
// btbType/hkd down: without them every reviewed row would report "Waiting PR
// Request Approval" while the modal it opens into said "Input PO No.".
eq("a small-amount row skips the approval stage",
  X.masterRecordWorkflowStep(row({ prNo: "PR1", reviewApprovalRaw: '{"review":"r.pdf"}',
    btbType: "NON-BTB", hkd: "1,000.00" })), "Input PO No.");
eq("a large-amount row stalls on it",
  X.masterRecordWorkflowStep(row({ prNo: "PR1", reviewApprovalRaw: '{"review":"r.pdf"}',
    btbType: "NON-BTB", hkd: "400,000.00" })), "Waiting PR Request Approval");
eq("the Approver column's own value", X.masterRecordApprover(row({ btbType: "BTB", hkd: "600,000" })), "AVP");

console.log("\n-- quotation expiry + the workflow tabs --");
// Built off getCurrentHKTDate itself so the test does not re-derive "today"
// and quietly disagree with the code about which calendar day it is.
const iso = (offsetDays) => {
  const d = X.getCurrentHKTDate();
  d.setDate(d.getDate() + offsetDays);
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
};
eq("yesterday -> expired", X.quotationExpiryInfo(iso(-1)).tone, "expired");
eq("today -> soon, 0 days", X.quotationExpiryInfo(iso(0)).tone, "soon");
eq("in 14 days -> still soon", X.quotationExpiryInfo(iso(14)).tone, "soon");
eq("in 15 days -> ok (the band is 14 wide)", X.quotationExpiryInfo(iso(15)).tone, "ok");
eq("no date -> null, not a guess", X.quotationExpiryInfo(""), null);
// A cancelled requisition's quotation going stale is not work anyone picks up,
// so counting it would inflate the two tabs used to decide what to chase.
eq("Expired excludes a cancelled record",
  X.matchesWorkflowTab(row({ status: "Cancel", quotationExpiryDate: iso(-5) }), "Expired"), false);
eq("Expired takes a live one", X.matchesWorkflowTab(row({ quotationExpiryDate: iso(-5) }), "Expired"), true);
eq("All takes everything, cancelled included", X.matchesWorkflowTab(row({ status: "Cancel" }), "All"), true);
eq("Cancelled matches through the stage", X.matchesWorkflowTab(row({ status: "Cancel" }), "Cancelled"), true);
eq("WORKFLOW_TABS is All + 2 expiry checks + 5 stages + Cancelled", X.WORKFLOW_TABS.length, 9);

console.log("\n-- column wiring --");
const keys = X.MASTER_RECORDS_COLUMNS.map(c => c.key);
eq("the Approver column exists", keys.includes("approver"), true);
// Approver is computed, so it has no column to write to -- it must stay out of
// the editable grid or it becomes a box that discards what is typed into it.
eq("Approver is kept out of the editable grid", X.MANAGE_GRID_EXCLUDED_KEYS.has("approver"), true);
const gridKeys = keys.filter(k => !X.MANAGE_GRID_EXCLUDED_KEYS.has(k));
eq("every editable-grid field states a value kind",
  gridKeys.filter(k => !X.MASTER_RECORDS_EDITABLE_FIELDS[k]), []);
// The other half, and the one a second hand-kept copy of the column names
// could not give: the key must resolve to a real column on the side this page
// runs on. saveAllPendingChanges drops a key with no column, so without this
// an unmapped field is a box that silently discards what is typed into it.
eq("every editable-grid field resolves to a dev column",
  gridKeys.filter(k => !X.SCHEMA.lis.records[k]), []);
// Everything the Manage modal writes outside the grid, plus the two the row
// itself writes -- none of these goes through MASTER_RECORDS_EDITABLE_FIELDS,
// so nothing above would notice one losing its column.
eq("the modal's non-grid writes resolve too",
  ["prNo", "poNo", "hkd", "btbType", "quotationExpiryDate", "review", "status", "flagged"]
    .filter(k => !X.SCHEMA.lis.records[k]), []);
eq("every column renders and exports",
  X.MASTER_RECORDS_COLUMNS.filter(c => typeof c.render !== "function" || typeof c.exportValue !== "function").map(c => c.key), []);

console.log("\n-- render --");
const render = (el) => ReactDOMServer.renderToStaticMarkup(el);
let html;
try {
  html = render(React.createElement(X.RecordsPage, {
    records: X.DEMO_RECORDS, demoMode: true, toggleDemo() {}, recordsLoadError: null,
    updateMasterRecordField() {}, updateMasterRecordFields: async () => true,
    fieldSaveError: null, dismissFieldSaveError() {},
  }));
} catch (e) {
  console.error("FAIL: RecordsPage threw while rendering:\n" + e.stack);
  process.exit(1);
}
console.log("OK   RecordsPage rendered (" + html.length + " bytes)");
const has = (label, needle) => {
  if (html.includes(needle)) console.log("OK   " + label);
  else { console.error("FAIL " + label + " -- missing: " + needle); failures++; }
};
has("the version pill", "V" + X.APP_VERSION);
has("the Cancelled Records KPI card", "Cancelled Records");
has("the Quotation Expired KPI card", "Quotation Expired");
// Both strips have to be present: they answer different questions (manual
// Status vs. computed stage) and are ANDed, so losing one silently widens the
// view rather than erroring.
has("the Workflow strip's label", ">Workflow<");
has("the Status strip's label", ">Status<");
has("a 6-wide KPI grid", "lg:grid-cols-6");
has("the Approver column header", "Approver");
if (html.includes("�")) { console.error("FAIL mojibake (U+FFFD) in the rendered output"); failures++; }
else console.log("OK   no mojibake in the rendered output");

const base = X.DEMO_RECORDS[0];
const smallRec = Object.assign({}, base, { hkd: "1,000.00", btbType: "NON-BTB", prNo: "PR1", poNo: "—", status: "Pending", reviewApprovalRaw: "" });
const bigRec = Object.assign({}, base, { hkd: "900,000.00", btbType: "NON-BTB", prNo: "PR1", poNo: "—", status: "Pending", reviewApprovalRaw: "" });
const cancelledRec = Object.assign({}, base, { status: "Cancel" });
const modal = (rec) => render(React.createElement(X.MasterRecordDetailModal, {
  record: rec, onClose() {}, onStatusChange() {}, onToggleFlag() {},
  updateMasterRecordField() {}, updateMasterRecordFields: async () => true,
  fieldSaveError: null, dismissFieldSaveError() {},
}));
let mSmall, mBig, mCancelled;
try { mSmall = modal(smallRec); mBig = modal(bigRec); mCancelled = modal(cancelledRec); }
catch (e) { console.error("FAIL: MasterRecordDetailModal threw:\n" + e.stack); process.exit(1); }
console.log("OK   MasterRecordDetailModal rendered for all three shapes");

const mhas = (label, hay, needle, want) => {
  if (hay.includes(needle) === want) console.log("OK   " + label);
  else { console.error("FAIL " + label + " -- " + (want ? "missing" : "unexpected") + ": " + needle); failures++; }
};
// The stage is absent from the LADDER, not merely greyed in it -- a greyed,
// permanently unreachable step reads as a stage still to come.
mhas("below threshold: the approval stage is not drawn at all", mSmall, "Waiting PR Request Approval", false);
mhas("below threshold: says Not required, never an em dash", mSmall, "Not required", true);
mhas("above threshold: the approval stage is drawn", mBig, "Waiting PR Request Approval", true);
mhas("above threshold: the approver is named", mBig, "MD", true);
mhas("a live record offers Record Cancel", mSmall, "Record Cancel", true);
mhas("a live record does not offer Re-open", mSmall, ">Re-open", false);
mhas("a cancelled record offers Re-open", mCancelled, "Re-open", true);
mhas("a cancelled record shows the cancellation banner", mCancelled, "Status: Cancelled", true);
mhas("a cancelled record cannot be cancelled again", mCancelled, "Record Cancel", false);
mhas("a cancelled record's Save is disabled", mCancelled, "cursor-not-allowed", true);

console.log("");
if (failures) { console.error(failures + " check(s) FAILED"); process.exit(1); }
console.log("all checks passed");
