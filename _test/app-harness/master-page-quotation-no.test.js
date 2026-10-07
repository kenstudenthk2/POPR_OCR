/* master-page-quotation-no.test.js
 * Verifies that in Master page_21-Sep-2026.html:
 * 1. "No." field (#edit-no) is removed from PR Info tab.
 * 2. "Remark" field (#edit-pr-remark) is removed from PR Info tab.
 * 3. "Quotation No." field (#edit-quotationno) is added to Quotation Info tab at md:col-start-2.
 * 4. Dataverse mapping binds admin_quotationno <-> QuotationNo.
 * 5. persistRecordToDataverse persists admin_quotationno.
 * 6. FIELD_ID_TO_RECORD_KEY maps edit-quotationno to QuotationNo.
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

// 1. Static HTML checks
ok("No. input #edit-no is removed from HTML", !HTML.includes('id="edit-no"'));
ok("PR Info Remark textarea #edit-pr-remark is removed from HTML", !HTML.includes('id="edit-pr-remark"'));
ok("Quotation No. input #edit-quotationno is present in HTML", HTML.includes('id="edit-quotationno"'));
ok("Quotation No. label is present in HTML", HTML.includes('Quotation No.</label>'));

// Verify Quotation No. is in tab-quotation
const tabQuotMatch = HTML.match(/<div id="tab-quotation"[\s\S]*?<\/div>\s*<\/div>\s*<!-- TAB 3:/);
ok("tab-quotation container found", !!tabQuotMatch);
if (tabQuotMatch) {
  const tabQuotHtml = tabQuotMatch[0];
  ok("Quotation No. is inside tab-quotation", tabQuotHtml.includes('id="edit-quotationno"'));
  ok("Quotation No. has md:col-start-2 to align under Vendor", tabQuotHtml.includes('md:col-start-2'));
}

// Verify PR Info tab doesn't have edit-no or edit-pr-remark
const tabPrMatch = HTML.match(/<div id="tab-pr"[\s\S]*?<\/div>\s*<\/div>\s*<!-- TAB 5:/);
ok("tab-pr container found", !!tabPrMatch);
if (tabPrMatch) {
  const tabPrHtml = tabPrMatch[0];
  ok("tab-pr does not contain edit-no", !tabPrHtml.includes('id="edit-no"'));
  ok("tab-pr does not contain edit-pr-remark", !tabPrHtml.includes('id="edit-pr-remark"'));
}

// 2. JavaScript script execution & data mappings
const scriptMatch = HTML.match(/<script>([\s\S]*?)<\/script>[\s\S]*?<\/body>/);
if (!scriptMatch) {
  console.error("FAIL: Could not extract script from Master page_21-Sep-2026.html");
  process.exit(1);
}

const SCRIPT_CODE = scriptMatch[1];

const updatedRecords = [];
const mockWebApi = {
  retrieveMultipleRecords: async () => ({ entities: [] }),
  updateRecord: async (entity, id, payload) => {
    updatedRecords.push({ entity, id, payload });
    return { id };
  }
};

const domStore = {};
function createMockEl(id, tagName = "input") {
  return {
    id,
    tagName: tagName.toUpperCase(),
    value: "",
    checked: false,
    disabled: false,
    classList: {
      add: () => {},
      remove: () => {},
      contains: () => false
    },
    style: {},
    options: [],
    setAttribute: () => {},
    removeAttribute: () => {},
    closest: () => null,
    addEventListener: () => {}
  };
}

const sandbox = {
  console,
  document: {
    addEventListener: () => {},
    getElementById: (id) => {
      if (!domStore[id]) {
        domStore[id] = createMockEl(id);
      }
      return domStore[id];
    },
    querySelectorAll: () => [],
    querySelector: () => null,
    createElement: (tag) => createMockEl("dyn-" + tag, tag)
  },
  window: {
    location: { search: "" },
    addEventListener: () => {}
  },
  location: { search: "" },
  localStorage: {
    getItem: () => null,
    setItem: () => {}
  },
  parent: {
    Xrm: {
      WebApi: mockWebApi
    }
  },
  URLSearchParams: class {
    get() { return null; }
    set() {}
    delete() {}
    toString() { return ""; }
  },
  setTimeout: (fn) => fn(),
  clearTimeout: () => {},
  EXPORTS: {}
};

sandbox.window.parent = sandbox.parent;

const scriptToRun = SCRIPT_CODE + `
EXPORTS.COLUMN_CONFIG = COLUMN_CONFIG;
EXPORTS.DV_COLUMN_MAP = DV_COLUMN_MAP;
EXPORTS.FIELD_ID_TO_RECORD_KEY = FIELD_ID_TO_RECORD_KEY;
EXPORTS.persistRecordToDataverse = persistRecordToDataverse;
EXPORTS.persistCurrentRecord = persistCurrentRecord;
EXPORTS.state = state;
`;

vm.createContext(sandbox);
vm.runInContext(scriptToRun, sandbox, { filename: "master-page-script.js" });

const X = sandbox.EXPORTS;

// 3. Verify mappings
ok("COLUMN_CONFIG includes QuotationNo", !!X.COLUMN_CONFIG.find(c => c.key === "QuotationNo"));
ok("DV_COLUMN_MAP maps admin_quotationno to QuotationNo", X.DV_COLUMN_MAP.admin_quotationno === "QuotationNo");
ok("FIELD_ID_TO_RECORD_KEY maps edit-quotationno to QuotationNo", X.FIELD_ID_TO_RECORD_KEY['edit-quotationno'] === "QuotationNo");

// 4. Test persistRecordToDataverse with QuotationNo
(async () => {
  const testRecord = {
    Id: "REC-TEST-Q",
    dataverseId: "guid-quot-001",
    _entityName: "admin_btb_lis_excel_datas",
    Title: "REC-TEST-Q",
    QuotationNo: "QT-2026-8888"
  };

  await X.persistRecordToDataverse(testRecord);

  eq("updateRecord was called once", updatedRecords.length, 1);
  const payload = updatedRecords[0]?.payload || {};
  eq("admin_quotationno in Dataverse payload", payload.admin_quotationno, "QT-2026-8888");

  // Test null / empty QuotationNo
  const testRecordEmpty = {
    Id: "REC-TEST-Q2",
    dataverseId: "guid-quot-002",
    _entityName: "admin_btb_lis_excel_datas",
    Title: "REC-TEST-Q2",
    QuotationNo: ""
  };
  await X.persistRecordToDataverse(testRecordEmpty);
  eq("empty QuotationNo saves as null", updatedRecords[1]?.payload?.admin_quotationno, null);

  if (failures > 0) {
    console.error(`\nFAILED: ${failures} check(s) failed.`);
    process.exit(1);
  } else {
    console.log("\nALL CHECKS PASSED: Quotation No. and PR Info field changes verified successfully.");
  }
})();
