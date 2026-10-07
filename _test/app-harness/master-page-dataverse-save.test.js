/* master-page-dataverse-save.test.js
 * Verifies that Master page_21-Sep-2026.html correctly formats and persists
 * fields to Dataverse table admin_btb_lis_excel_datas:
 *  - Float columns (PO Amount HK$, No.) are numbers or null, never strings or empty strings
 *  - Date-only column (PR Issued Month) is formatted as YYYY-MM-01, never 2-digit month
 *  - admin_itemno, admin_buyer, admin_markreceivedate are mapped in DV_COLUMN_MAP and saved
 *  - admin_sbreportgenrated is included from SBReportGenerated
 *  - PR_Status choice values are 1-based (Completed = 1, Pending = 2, Cancel = 3, Return = 4, Duplicate = 5)
 *  - edit-pr-remark maps to Remarks / PRRemarks
 *  - PR Amount handling matches PR Assistant App dev side buildLisExcelPayload (1 USD : 7.9 HKD rate,
 *    admin_pramount, admin_pramounthkd, admin_pramountusd, admin_hkd, admin_usdx0020x002fx0020others)
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
      textContent: "",
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
      removeEventListener: () => {},
      setAttribute: function(k, v) { this[k] = v; },
      removeAttribute: function(k) { delete this[k]; }
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
EXPORTS.convertPrAmount = convertPrAmount;
EXPORTS.handlePRAmount = handlePRAmount;
EXPORTS.getDualApprovers = getDualApprovers;
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
  eq("DV_COLUMN_MAP maps admin_itemno to ItemNo", X.DV_COLUMN_MAP.admin_itemno, "ItemNo");
  eq("DV_COLUMN_MAP maps admin_buyer to Buyer", X.DV_COLUMN_MAP.admin_buyer, "Buyer");
  eq("DV_COLUMN_MAP maps admin_markreceivedate to MarkReceiptDate", X.DV_COLUMN_MAP.admin_markreceivedate, "MarkReceiptDate");

  // 3. Test convertPrAmount helper
  const hkdConv = X.convertPrAmount(16000, "HKD");
  eq("HKD conversion hkd text", hkdConv.prAmountHkd, "16000");
  eq("HKD conversion usd text at 7.9", hkdConv.prAmountUsd, "2025.32");

  const usdConv = X.convertPrAmount(2000, "USD");
  eq("USD conversion usd text", usdConv.prAmountUsd, "2000");
  eq("USD conversion hkd text at 7.9", usdConv.prAmountHkd, "15800");

  // 4. Test persistRecordToDataverse formatting for HKD
  updatedRecords.length = 0;
  await X.persistRecordToDataverse({
    Title: "REC-TEST-1",
    dataverseId: "guid-rec-1",
    PRAmount: 16000,
    Currency: "HKD",
    POAmount: 12500.50,
    No: "42",
    PRIssuedOn: "2026-10-15",
    PRIssuedMonth: "10",
    Status: "Completed",
    SBReportGenerated: "2026-10-06",
    PRRemarks: "Special discount applied",
    CustomerName: "Test Customer",
    Vendor: "Test Vendor",
    ItemNo: "ITM-99",
    Buyer: "Chan, Peter",
    MarkReceiptDate: "2026-10-10",
    ChargeCCC: "C716",
    AccountCode: "512100",
    WorksOrderCode: "WO-SEC-01"
  });

  eq("updateRecord was called once in bulk mode", updatedRecords.length, 1);
  const pHkd = updatedRecords[0].payload;

  eq("admin_chargex0020ccc is saved in payload", pHkd.admin_chargex0020ccc, "C716");
  eq("admin_accountx0020code is saved in payload", pHkd.admin_accountx0020code, "512100");
  eq("admin_worksx0020orderx0020code is saved in payload", pHkd.admin_worksx0020orderx0020code, "WO-SEC-01");

  eq("admin_itemno is included in payload", pHkd.admin_itemno, "ITM-99");
  eq("admin_buyer is included in payload", pHkd.admin_buyer, "Chan, Peter");
  eq("admin_markreceivedate is included in payload", pHkd.admin_markreceivedate, "2026-10-10");
  eq("PO Amount HK$ is numeric Float", pHkd.admin_pox0020amountx0020hkx0024, 12500.50);
  eq("PO_Amount text copy is String", pHkd.admin_poamount, "12500.5");
  eq("No. is numeric Float", pHkd.admin_nox002e, 42);
  eq("PR Issued Month is formatted as YYYY-MM-01", pHkd.admin_prx0020issuedx0020month, "2026-10-01");
  eq("PR Status choice is 1 for Completed", pHkd.admin_prstatus, 1);
  eq("SB Report Generated is included", pHkd.admin_sbreportgenrated, "2026-10-06");
  eq("PRRemarks is saved to admin_remarks", pHkd.admin_remarks, "Special discount applied");

  // HKD fields in payload
  eq("HKD: admin_pramount is string", pHkd.admin_pramount, "16000");
  eq("HKD: admin_hkd is numeric", pHkd.admin_hkd, 16000);
  eq("HKD: admin_pramounthkd is string", pHkd.admin_pramounthkd, "16000");
  eq("HKD: admin_pramountusd is converted string", pHkd.admin_pramountusd, "2025.32");
  eq("HKD: admin_hkdusd is HKD", pHkd.admin_hkdusd, "HKD");
  eq("HKD: admin_usdx0020x002fx0020others is null", pHkd.admin_usdx0020x002fx0020others, null);

  // 5. Test persistRecordToDataverse formatting for USD
  updatedRecords.length = 0;
  await X.persistRecordToDataverse({
    Title: "REC-TEST-1",
    dataverseId: "guid-rec-1",
    PRAmount: 2000,
    Currency: "USD"
  });

  eq("updateRecord was called for USD", updatedRecords.length, 1);
  const pUsd = updatedRecords[0].payload;

  eq("USD: admin_pramount is string", pUsd.admin_pramount, "2000");
  eq("USD: admin_hkd is null for USD", pUsd.admin_hkd, null);
  eq("USD: admin_pramounthkd is converted string", pUsd.admin_pramounthkd, "15800");
  eq("USD: admin_pramountusd is string", pUsd.admin_pramountusd, "2000");
  eq("USD: admin_hkdusd is USD", pUsd.admin_hkdusd, "USD");
  eq("USD: admin_usdx0020x002fx0020others is string", pUsd.admin_usdx0020x002fx0020others, "2000");

  // 6. Test fallback mode when bulk update throws
  const fieldUpdates = [];
  sandbox.parent.Xrm.WebApi.updateRecord = async (entity, id, payload) => {
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
