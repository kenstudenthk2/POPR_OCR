/* master-page-dataverse-save.test.js
 * Verifies that Master page_21-Sep-2026.html correctly formats and persists
 * fields to Dataverse table admin_btb_lis_excel_datas:
 *  - Float columns (PO Amount HK$, No.) are numbers or null, never strings or empty strings
 *  - Date-only column (PR Issued Month) is formatted as YYYY-MM-01, never 2-digit month
 *  - Non-existent column admin_itemno is omitted from payload
 *  - admin_sbreportgenrated is included from SBReportGenerated
 *  - PR_Status choice values are 1-based (Completed = 1, Pending = 2, Cancel = 3, Return = 4, Duplicate = 5)
 *  - edit-pr-remark maps to Remarks / PRRemarks
 *  - Fallback field-by-field update saves all valid fields without aborting
 */

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const HTML_PATH = path.resolve(__dirname, "../../Master page_21-Sep-2026.html");
const HTML = fs.readFileSync(HTML_PATH, "utf8");

let failures = 0;
const eq = (label, a, b) => {
  if (a === b) {
    console.log("OK   " + label);
    return;
  }
  failures++;
  console.error("FAIL " + label + "\n     expected " + JSON.stringify(b) + "\n     actual   " + JSON.stringify(a));
};
const ok = (label, cond) => eq(label, !!cond, true);

// 1. Verify static code rules
ok("FIELD_ID_TO_RECORD_KEY includes edit-pr-remark", HTML.includes("'edit-pr-remark': 'PRRemarks'"));
ok("PR_STATUS_MAP maps Completed to 1", HTML.includes('"Completed": 1'));

// 2. Setup sandbox execution
const scriptMatch = HTML.match(/<script>([\s\S]*?)<\/script>[\s\S]*?<\/body>/);
if (!scriptMatch) {
  console.error("FAIL: Could not extract script from Master page_21-Sep-2026.html");
  process.exit(1);
}

let SCRIPT_CODE = scriptMatch[1];

const updatedRecords = [];
const mockWebApi = {
  updateRecord: async (entity, id, payload) => {
    updatedRecords.push({ entity, id, payload });
    return { id };
  },
  retrieveMultipleRecords: async (entity, query) => {
    return { entities: [{ admin_title: "REC-TEST-1", admin_btb_lis_excel_datasid: "guid-rec-1" }] };
  }
};

const domStore = {};
function getMockElement(id) {
  if (!domStore[id]) {
    domStore[id] = {
      id,
      value: "",
      innerText: "",
      innerHTML: "",
      disabled: false,
      checked: false,
      dataset: {},
      options: [],
      classList: {
        _classes: new Set(),
        add(...c) { c.forEach(x => this._classes.add(x)); },
        remove(...c) { c.forEach(x => this._classes.delete(x)); },
        contains(x) { return this._classes.has(x); },
        toggle(x) { this._classes.has(x) ? this._classes.delete(x) : this._classes.add(x); }
      },
      querySelectorAll: () => [],
      querySelector: () => null,
      appendChild: () => {},
      addEventListener: () => {},
      removeEventListener: () => {}
    };
  }
  return domStore[id];
}

const sandbox = {
  console,
  document: {
    getElementById: (id) => getMockElement(id),
    querySelectorAll: () => [],
    querySelector: () => null,
    addEventListener: () => {},
    createElement: (tag) => getMockElement("tag-" + Math.random())
  },
  parent: { Xrm: { WebApi: mockWebApi } },
  window: {
    location: { search: "" },
    parent: { Xrm: { WebApi: mockWebApi } },
    Xrm: { WebApi: mockWebApi }
  },
  Xrm: { WebApi: mockWebApi },
  location: { search: "" },
  localStorage: { getItem: () => null, setItem: () => {} },
  setTimeout: (fn) => fn(),
  clearTimeout: () => {},
  URLSearchParams: class {
    get() { return null; }
    set() {}
    delete() {}
    toString() { return ""; }
  },
  EXPORTS: {}
};

SCRIPT_CODE += `
EXPORTS.persistRecordToDataverse = persistRecordToDataverse;
EXPORTS.DV_COLUMN_MAP = DV_COLUMN_MAP;
EXPORTS.FIELD_ID_TO_RECORD_KEY = FIELD_ID_TO_RECORD_KEY;
EXPORTS.PR_STATUS_MAP = PR_STATUS_MAP;
EXPORTS.PR_STATUS_CHOICES = PR_STATUS_CHOICES;
EXPORTS.formatDateForInput = formatDateForInput;
EXPORTS.state = state;
`;

try {
  vm.createContext(sandbox);
  vm.runInContext(SCRIPT_CODE, sandbox, { filename: "master-page-script.js" });
} catch (e) {
  console.error("FAIL: script body threw at load time:\n" + e.stack);
  process.exit(1);
}

const X = sandbox.EXPORTS;

(async () => {
  ok("DV_COLUMN_MAP does not include admin_itemno", X.DV_COLUMN_MAP.admin_itemno === undefined);

  // 3. Test persistRecordToDataverse formatting
  updatedRecords.length = 0;
  await X.persistRecordToDataverse({
    Title: "REC-TEST-1",
    dataverseId: "guid-rec-1",
    POAmount: 12500.50,
    No: "42",
    PRIssuedOn: "2026-10-15",
    PRIssuedMonth: "10",
    Status: "Completed",
    SBReportGenerated: "2026-10-06",
    PRRemarks: "Special discount applied",
    CustomerName: "Test Customer",
    Vendor: "Test Vendor"
  });

  eq("updateRecord was called once in bulk mode", updatedRecords.length, 1);
  const p = updatedRecords[0].payload;

  eq("admin_itemno is omitted from payload", p.admin_itemno, undefined);
  eq("PO Amount HK$ is numeric Float", p.admin_pox0020amountx0020hkx0024, 12500.50);
  eq("PO_Amount text copy is String", p.admin_poamount, "12500.5");
  eq("No. is numeric Float", p.admin_nox002e, 42);
  eq("PR Issued Month is formatted as YYYY-MM-01", p.admin_prx0020issuedx0020month, "2026-10-01");
  eq("PR Status choice is 1 for Completed", p.admin_prstatus, 1);
  eq("SB Report Generated is included", p.admin_sbreportgenrated, "2026-10-06");
  eq("PRRemarks is saved to admin_remarks", p.admin_remarks, "Special discount applied");

  // 4. Test fallback mode when bulk update throws
  const fieldUpdates = [];
  sandbox.parent.Xrm.WebApi.updateRecord = async (entity, id, payload) => {
    // If payload has multiple keys, simulate bulk failure
    if (Object.keys(payload).length > 1) {
      throw new Error("Bulk update failed in Dataverse");
    }
    fieldUpdates.push(payload);
    return { id };
  };

  await X.persistRecordToDataverse({
    Title: "REC-TEST-1",
    dataverseId: "guid-rec-1",
    CustomerName: "Fallback Customer",
    Vendor: "Fallback Vendor",
    POAmount: 999.99
  });

  ok("Fallback executed per-field updates without aborting", fieldUpdates.length >= 3);
  const hasCustomer = fieldUpdates.some(u => u.admin_customerx0020name === "Fallback Customer");
  const hasVendor = fieldUpdates.some(u => u.admin_vendor === "Fallback Vendor");
  const hasPOAmount = fieldUpdates.some(u => u.admin_pox0020amountx0020hkx0024 === 999.99);

  ok("Fallback saved Customer Name", hasCustomer);
  ok("Fallback saved Vendor", hasVendor);
  ok("Fallback saved PO Amount", hasPOAmount);

  if (failures === 0) {
    console.log("\nALL CHECKS PASSED: Dataverse save formatting and fallback verified successfully.");
    process.exit(0);
  } else {
    console.error(`\n${failures} check(s) failed.`);
    process.exit(1);
  }
})();
