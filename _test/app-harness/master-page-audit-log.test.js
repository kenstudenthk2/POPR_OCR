/* master-page-audit-log.test.js -- Verification for Audit Log in Master page_21-Sep-2026.html
   Tests:
   1. AUDIT_LOG_TABLE is "admin_btb_audit_log"
   2. Monitored fields are exactly "PR No.", "PR Amount", "PO No.", "PO Amount"
   3. normalizeAuditValue and hasAuditValueChanged accurately detect changes without false positives (e.g. null vs empty, commas, trailing decimals)
   4. checkAndLogFieldChanges produces correct audit log records with:
      - admin_modifyby: processadmin
      - admin_whenmodify: ISO timestamp
      - admin_modifyfield: exact field label
      - admin_existingvalue: old value as string
      - admin_newvalue: new value as string
      - admin_caserecordid: Record ID
   5. Unmonitored fields (e.g. Vendor, Customer Name) do NOT produce audit logs
   6. Integration with openEditModal and persistCurrentRecord:
      - Changing PR No. logs to admin_btb_audit_log
      - Changing PR Amount logs to admin_btb_audit_log
      - Changing PO No. logs to admin_btb_audit_log
      - Changing PO Amount logs to admin_btb_audit_log
      - Multiple simultaneous changes produce multiple separate audit log records
      - Unchanged fields produce 0 audit logs
*/

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const REPO = path.resolve(__dirname, "../..");
const HTML_PATH = path.join(REPO, "Master page_21-Sep-2026.html");

function assert(condition, message) {
  if (!condition) {
    console.error("FAIL: " + message);
    process.exit(1);
  }
  console.log("OK   " + message);
}

const html = fs.readFileSync(HTML_PATH, "utf8");

// ── 1. Structural Checks on HTML ─────────────────────────────────────────────
assert(html.includes("admin_btb_audit_log"), "HTML includes table name 'admin_btb_audit_log'");
assert(html.includes("admin_modifyby"), "HTML includes column 'admin_modifyby'");
assert(html.includes("admin_whenmodify"), "HTML includes column 'admin_whenmodify'");
assert(html.includes("admin_modifyfield"), "HTML includes column 'admin_modifyfield'");
assert(html.includes("admin_existingvalue"), "HTML includes column 'admin_existingvalue'");
assert(html.includes("admin_newvalue"), "HTML includes column 'admin_newvalue'");
assert(html.includes("admin_caserecordid"), "HTML includes column 'admin_caserecordid'");

// ── 2. Script Execution in Sandbox ───────────────────────────────────────────
const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>[\s\S]*?<\/body>/);
assert(!!scriptMatch, "Found embedded script in Master page_21-Sep-2026.html");

const mockLocalStorage = {
  processadmin: "Lee, Mandy MY",
};

const createdDataverseRecords = [];

const elements = {};
function getMockElement(id) {
  if (!elements[id]) {
    elements[id] = {
      id,
      value: "",
      disabled: false,
      classList: {
        classes: new Set(),
        add(cls) { this.classes.add(cls); },
        remove(cls) { this.classes.delete(cls); },
        contains(cls) { return this.classes.has(cls); },
      },
      innerHTML: "",
      textContent: "",
      focus() { this.focused = true; },
      style: {},
      setAttribute() {},
      removeAttribute() {},
      appendChild() {},
      remove() {},
      closest() { return null; },
      querySelectorAll() { return []; },
    };
  }
  return elements[id];
}

const mockWebApi = {
  createRecord: async (entity, payload) => {
    createdDataverseRecords.push({ entity, payload });
    return { id: "audit-guid-" + createdDataverseRecords.length };
  },
  updateRecord: async () => ({ id: "update-id" }),
  retrieveMultipleRecords: async () => ({ entities: [] }),
};

const sandbox = {
  window: {
    localStorage: {
      getItem(k) { return (k in mockLocalStorage) ? mockLocalStorage[k] : null; },
      setItem(k, v) { mockLocalStorage[k] = String(v); },
      removeItem(k) { delete mockLocalStorage[k]; },
    },
    location: { href: "http://localhost/MasterPage.html", search: "" },
    history: { pushState() {} },
    addEventListener() {},
    removeEventListener() {},
    Xrm: { WebApi: mockWebApi },
  },
  document: {
    getElementById(id) { return getMockElement(id); },
    querySelectorAll() { return []; },
    addEventListener() {},
    removeEventListener() {},
    createElement() {
      return {
        style: {},
        classList: { add() {}, remove() {} },
        appendChild() {},
        remove() {},
      };
    },
  },
  parent: { Xrm: { WebApi: mockWebApi } },
  Xrm: { WebApi: mockWebApi },
  console,
  setTimeout(fn) { if (typeof fn === "function") fn(); },
  clearTimeout() {},
  setInterval() {},
  clearInterval() {},
  URL,
  URLSearchParams,
  XLSX: { utils: { book_new: () => ({}), book_append_sheet: () => {} }, writeFile: () => {} },
  showLoader: () => {},
  showToast: () => {},
  openParamItem: () => {},
};

sandbox.globalThis = sandbox;
sandbox.window.window = sandbox.window;
sandbox.localStorage = sandbox.window.localStorage;
sandbox.location = sandbox.window.location;
sandbox.history = sandbox.window.history;

vm.createContext(sandbox);
vm.runInContext(scriptMatch[1], sandbox);

(async () => {
  // ── 3. Table and Monitored Fields ───────────────────────────────────────────
  assert(sandbox.AUDIT_LOG_TABLE === "admin_btb_audit_log", "AUDIT_LOG_TABLE is 'admin_btb_audit_log'");
  assert(Array.isArray(sandbox.MONITORED_AUDIT_FIELDS), "MONITORED_AUDIT_FIELDS is an array");
  const fieldLabels = sandbox.MONITORED_AUDIT_FIELDS.map(f => f.label);
  assert(fieldLabels.includes("PR No."), "Monitors 'PR No.'");
  assert(fieldLabels.includes("PR Amount"), "Monitors 'PR Amount'");
  assert(fieldLabels.includes("PO No."), "Monitors 'PO No.'");
  assert(fieldLabels.includes("PO Amount"), "Monitors 'PO Amount'");
  assert(fieldLabels.length === 4, "Monitors exactly 4 fields");

  // ── 4. Value comparison logic ───────────────────────────────────────────────
  const { hasAuditValueChanged, normalizeAuditValue } = sandbox;
  assert(!hasAuditValueChanged(null, "", false), "null vs empty string is not a change");
  assert(!hasAuditValueChanged("128,400.00", 128400, true), "number with comma and decimals matches numeric value");
  assert(hasAuditValueChanged("6306168", "6306169", false), "PR No. change is detected");
  assert(hasAuditValueChanged(10000, 20000, true), "PR Amount change is detected");
  assert(hasAuditValueChanged("ZM1606282", "ZM1606283", false), "PO No. change is detected");
  assert(hasAuditValueChanged(5000, 6000, true), "PO Amount change is detected");

  // ── 5. checkAndLogFieldChanges unit test ────────────────────────────────────
  const snapshot = {
    Id: "1",
    Title: "ATQ-2026-001",
    PRNo: "6306168",
    PRAmount: 128400,
    PONo: "ZM1606282",
    POAmount: 128400,
  };

  const updatedItem = {
    Id: "1",
    Title: "ATQ-2026-001",
    PRNo: "6306169",     // changed
    PRAmount: 150000,     // changed
    PONo: "ZM1606282",    // unchanged
    POAmount: 128400,     // unchanged
    Vendor: "New Vendor", // unmonitored change
  };

  const logs = sandbox.checkAndLogFieldChanges(updatedItem, snapshot);
  assert(logs.length === 2, "Produces exactly 2 audit log entries for the 2 changed monitored fields");

  const prNoLog = logs.find(l => l.admin_modifyfield === "PR No.");
  assert(!!prNoLog, "Found log for PR No.");
  assert(prNoLog.admin_modifyby === "Lee, Mandy MY", "admin_modifyby contains processadmin");
  assert(prNoLog.admin_existingvalue === "6306168", "admin_existingvalue is 6306168");
  assert(prNoLog.admin_newvalue === "6306169", "admin_newvalue is 6306169");
  assert(prNoLog.admin_caserecordid === "ATQ-2026-001", "admin_caserecordid is ATQ-2026-001");
  assert(Boolean(prNoLog.admin_whenmodify && prNoLog.admin_whenmodify.includes("T")), "admin_whenmodify is ISO date string");

  const prAmtLog = logs.find(l => l.admin_modifyfield === "PR Amount.");
  const prAmtLogFound = logs.find(l => l.admin_modifyfield === "PR Amount");
  assert(!!prAmtLogFound, "Found log for PR Amount");
  assert(prAmtLogFound.admin_existingvalue === "128400", "admin_existingvalue is 128400");
  assert(prAmtLogFound.admin_newvalue === "150000", "admin_newvalue is 150000");

  // ── 6. Integration: openEditModal and persistCurrentRecord ──────────────────
  sandbox.state.allData = [
    {
      Id: "REC-100",
      Title: "REC-100",
      RecordIdNo: "REC-100",
      PRNo: "7777777",
      PRAmount: 50000,
      PONo: "AB1234567",
      POAmount: 50000,
      CustomerName: "ABC Ltd",
      Vendor: "Cisco",
      ProcessStatus: "PO No. Ready",
    },
  ];

  // Open edit modal for REC-100
  sandbox.openEditModal("REC-100");
  assert(sandbox.state.originalRecordSnapshot !== null, "originalRecordSnapshot is set when opening modal");
  assert(sandbox.state.originalRecordSnapshot.PRNo === "7777777", "original snapshot has original PRNo");
  assert(sandbox.state.originalRecordSnapshot.PONo === "AB1234567", "original snapshot has original PONo");

  // Simulate user changing PR No. and PO Amount in the DOM
  getMockElement("edit-id").value = "REC-100";
  getMockElement("edit-prno").value = "8888888";
  getMockElement("edit-pramount").value = "50000";
  getMockElement("edit-pono").value = "AB1234567";
  getMockElement("edit-poamount").value = "99000";

  createdDataverseRecords.length = 0;
  sandbox.persistCurrentRecord(false, true);
  await new Promise(r => setTimeout(r, 20));

  // Check created audit log records in Dataverse
  const auditCreates = createdDataverseRecords.filter(r => r.entity === "admin_btb_audit_log");
  assert(auditCreates.length === 2, "Created 2 audit log records in Dataverse for PR No and PO Amount");

  const prAudit = auditCreates.find(c => c.payload.admin_modifyfield === "PR No.");
  assert(!!prAudit, "Audit record created for PR No.");
  assert(prAudit.payload.admin_existingvalue === "7777777", "PR No. existing value is 7777777");
  assert(prAudit.payload.admin_newvalue === "8888888", "PR No. new value is 8888888");
  assert(prAudit.payload.admin_modifyby === "Lee, Mandy MY", "PR No. modifyby is processadmin");
  assert(prAudit.payload.admin_caserecordid === "REC-100", "PR No. caserecordid is REC-100");

  const poAmtAudit = auditCreates.find(c => c.payload.admin_modifyfield === "PO Amount");
  assert(!!poAmtAudit, "Audit record created for PO Amount");
  assert(poAmtAudit.payload.admin_existingvalue === "50000", "PO Amount existing value is 50000");
  assert(poAmtAudit.payload.admin_newvalue === "99000", "PO Amount new value is 99000");

  // Subsequent save without changes should produce 0 additional audit records
  createdDataverseRecords.length = 0;
  sandbox.persistCurrentRecord(false, true);
  await new Promise(r => setTimeout(r, 20));
  const secondAuditCreates = createdDataverseRecords.filter(r => r.entity === "admin_btb_audit_log");
  assert(secondAuditCreates.length === 0, "No additional audit log records created when values unchanged");

  // ── 7. Sub-record admin_caserecordid check (Record_ID / admin_title) ────────
  if (typeof sandbox.getRecordAdminTitle === "function") {
    assert(sandbox.getRecordAdminTitle({ admin_title: "ATQ-2026-001-Sub2" }) === "ATQ-2026-001-Sub2", "getRecordAdminTitle prefers admin_title");
    assert(sandbox.getRecordAdminTitle({ Title: "ATQ-2026-001", SubNumber: "Sub3" }) === "ATQ-2026-001-Sub3", "getRecordAdminTitle constructs Title-SubNumber");
    assert(sandbox.getRecordAdminTitle({ RecordIdNo: "ATQ-2026-001", SubNumber: "Sub4" }) === "ATQ-2026-001-Sub4", "getRecordAdminTitle constructs RecordIdNo-SubNumber");
  }

  const subItemSnapshot = {
    Id: "SUB-1",
    Title: "ATQ-2026-001",
    RecordIdNo: "ATQ-2026-001",
    SubNumber: "Sub1",
    admin_title: "ATQ-2026-001-Sub1",
    PRNo: "1111111",
    PRAmount: 1000,
  };
  const subItemUpdated = {
    ...subItemSnapshot,
    PRNo: "2222222",
  };
  const subLogs = sandbox.checkAndLogFieldChanges(subItemUpdated, subItemSnapshot);
  assert(subLogs.length === 1, "checkAndLogFieldChanges produces 1 log for sub-record change");
  assert(subLogs[0].admin_caserecordid === "ATQ-2026-001-Sub1", "admin_caserecordid records Record_ID (admin_title) value for sub-record");

  console.log("\nALL AUDIT LOG TESTS PASSED!");
})();
