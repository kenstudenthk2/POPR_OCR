/* master-page-sbreport.test.js -- Verification for SB Report Generated editable checkbox
   ---------------------------------------------------------------------------------------
   Verifies that Master page_21-Sep-2026.html allows users to edit the "SB Report Generated"
   checkbox in the table rows and in the record edit modal.
*/
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const REPO = path.resolve(__dirname, "..", "..");
const HTML_PATH = path.join(REPO, "Master page_21-Sep-2026.html");
const HTML = fs.readFileSync(HTML_PATH, "utf8");

let failures = 0;
const eq = (label, actual, expected) => {
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  if (a === b) { console.log("OK   " + label); return; }
  failures++;
  console.error("FAIL " + label + "\n     expected " + b + "\n     actual   " + a);
};
const ok = (label, cond) => eq(label, !!cond, true);

// 1. Table markup verification
ok("Table cell checkbox is NOT disabled",
  !HTML.includes('<input type="checkbox" ${isChecked} disabled\n                                        class="w-4 h-4 rounded border-[#C5BEB6] text-[var(--orange)] accent-[var(--orange)] cursor-default disabled:opacity-100 pointer-events-none"'));

ok("Table cell checkbox has handleSBReportCheckboxChange handler",
  HTML.includes('onchange="handleSBReportCheckboxChange(event, this)"'));

ok("Table cell checkbox has stopPropagation",
  HTML.includes('onclick="event.stopPropagation()"'));

ok("Table cell checkbox carries data-id",
  HTML.includes('data-id="${escapeHtml(String(item.Id))}"'));

ok("Table cell carries .sb-date-text container",
  HTML.includes('class="sb-date-text'));

// 2. Edit Modal markup verification
ok("Edit modal carries edit-sbreportgenerated field",
  HTML.includes('id="edit-sbreportgenerated"'));

ok("FIELD_ID_TO_RECORD_KEY maps edit-sbreportgenerated to SBReportGenerated",
  HTML.includes("'edit-sbreportgenerated': 'SBReportGenerated'"));

// 3. Logic execution in sandbox
const scriptMatch = HTML.match(/<script>([\s\S]*?)<\/script>[\s\S]*?<\/body>/);
if (!scriptMatch) {
  console.error("FAIL: could not extract script block from " + HTML_PATH);
  process.exit(1);
}

let updatedRecords = [];
const mockWebApi = {
  retrieveMultipleRecords: async (entity, query) => ({
    entities: [{ admin_btb_lis_excel_dataid: "guid-123", admin_title: "REC-001" }]
  }),
  updateRecord: async (entity, id, payload) => {
    updatedRecords.push({ entity, id, payload });
  }
};

const sandbox = {
  console,
  setTimeout, clearTimeout,
  TextEncoder, Uint8Array,
  window: { addEventListener() {}, localStorage: { getItem: () => null, setItem: () => {} } },
  document: {
    addEventListener() {},
    getElementById: (id) => ({
      id,
      innerText: "",
      value: "",
      classList: { remove() {}, add() {}, contains: () => false },
      appendChild: () => {},
      removeChild: () => {},
      querySelector: () => null
    }),
    createElement: () => ({ setAttribute() {}, appendChild() {}, remove: () => {}, click() {}, style: {} }),
    body: { appendChild() {}, removeChild() {} },
  },
  parent: { Xrm: { WebApi: mockWebApi } },
  URL: { createObjectURL: () => "blob:fake", revokeObjectURL: () => {} },
  Blob: function(parts, opts) { this.parts = parts; this.opts = opts; },
  Date,
  Math,
  String,
  Number,
  Array,
  Object,
  JSON,
  EXPORTS: {},
};
sandbox.globalThis = sandbox;

const SCRIPT_CODE = scriptMatch[1] + `
;EXPORTS.state = state;
EXPORTS.handleSBReportCheckboxChange = handleSBReportCheckboxChange;
EXPORTS.FIELD_ID_TO_RECORD_KEY = FIELD_ID_TO_RECORD_KEY;
`;

try {
  vm.createContext(sandbox);
  vm.runInContext(SCRIPT_CODE, sandbox, { filename: "master-page-script.js" });
} catch (e) {
  console.error("FAIL: script body threw at load time:\n" + e.stack);
  process.exit(1);
}
console.log("OK   script body evaluated cleanly");

const X = sandbox.EXPORTS;

// Populate state with sample record
const sampleRecord = {
  Id: "REC-001",
  Title: "REC-001",
  SBReportGenerated: "",
  CustomerName: "Test Customer",
};
X.state.allData = [sampleRecord];

// Test checking the box
const mockDateSpan = { innerText: "" };
const mockParent = {
  querySelector: (sel) => (sel === ".sb-date-text" ? mockDateSpan : null)
};
const mockCheckbox = {
  dataset: { id: "REC-001" },
  checked: true,
  title: "",
  parentElement: mockParent
};
const mockEvent = { stopPropagation: () => {} };

(async () => {
  await X.handleSBReportCheckboxChange(mockEvent, mockCheckbox);

  const today = new Date().toISOString().split("T")[0];
  eq("item.SBReportGenerated is set to today", sampleRecord.SBReportGenerated, today);
  eq("checkbox title is updated to date", mockCheckbox.title, today);
  eq("dateSpan innerText is updated to date", mockDateSpan.innerText, today);

  // Test unchecking the box
  mockCheckbox.checked = false;
  await X.handleSBReportCheckboxChange(mockEvent, mockCheckbox);

  eq("item.SBReportGenerated is cleared", sampleRecord.SBReportGenerated, "");
  eq("checkbox title is reset", mockCheckbox.title, "Check to mark SB Report generated");
  eq("dateSpan innerText is cleared", mockDateSpan.innerText, "");

  // Verify Dataverse WebApi call
  ok("WebApi updateRecord was called", updatedRecords.length > 0);
  const lastUpdate = updatedRecords[updatedRecords.length - 1];
  eq("entity is admin_btb_lis_excel_datas", lastUpdate.entity, "admin_btb_lis_excel_datas");
  eq("id is guid-123", lastUpdate.id, "guid-123");
  eq("payload cleared admin_sbreportgenrated", lastUpdate.payload.admin_sbreportgenrated, null);

  if (failures > 0) {
    console.error(`\nFAILED: ${failures} assertions failed.`);
    process.exit(1);
  } else {
    console.log("\nALL CHECKS PASSED: SB Report Generated editable checkbox verified successfully.");
  }
})();
