/* master-page-history.test.js -- Verification for History button and History Modal in Master page_21-Sep-2026.html
   Tests:
   1. Structural checks on HTML:
      - #btn-modal-history exists in editModal header
      - #btn-modal-history is placed before #btn-modal-remark
      - #btn-modal-history has onclick="openHistoryModal()"
      - #historyModal exists with table and close controls
   2. Script execution & functions:
      - openHistoryModal, closeHistoryModal, refreshHistoryModal, fetchAuditLogsForRecord, renderHistoryTable are defined
   3. History modal lifecycle:
      - openHistoryModal opens the modal and updates subtitle with record ID
      - closeHistoryModal closes the modal
      - renderHistoryTable handles empty and populated logs
      - fetchAuditLogsForRecord retrieves matching in-memory and Dataverse logs
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
assert(html.includes('id="btn-modal-history"'), "HTML includes #btn-modal-history");
assert(html.includes('onclick="openHistoryModal()"'), "#btn-modal-history calls openHistoryModal()");
assert(html.includes('id="btn-modal-remark"'), "HTML includes #btn-modal-remark");

const historyBtnPos = html.indexOf('id="btn-modal-history"');
const remarkBtnPos = html.indexOf('id="btn-modal-remark"');
assert(historyBtnPos !== -1 && remarkBtnPos !== -1 && historyBtnPos < remarkBtnPos, "#btn-modal-history is placed before #btn-modal-remark in modal header");

assert(html.includes('id="historyModal"'), "HTML includes #historyModal container");
assert(html.includes('id="history-tab-update"'), "HTML includes #history-tab-update tab");
assert(html.includes('id="history-tab-remarks"'), "HTML includes #history-tab-remarks tab");
assert(html.includes('id="history-tab-update-count"'), "HTML includes #history-tab-update-count");
assert(html.includes('id="history-tab-remarks-count"'), "HTML includes #history-tab-remarks-count");
assert(html.includes('id="history-records-table"'), "HTML includes #history-records-table");
assert(html.includes('id="history-records-thead"'), "HTML includes #history-records-thead");
assert(html.includes('id="history-records-tbody"'), "HTML includes #history-records-tbody");
assert(html.includes('id="history-modal-subtitle"'), "HTML includes #history-modal-subtitle");
assert(html.includes('id="history-modal-count"'), "HTML includes #history-modal-count");
assert(html.includes('onclick="closeHistoryModal()"'), "HTML includes closeHistoryModal handler");
assert(html.includes('onclick="refreshHistoryModal()"'), "HTML includes refreshHistoryModal handler");
assert(html.includes("switchHistoryTab('update')"), "HTML includes switchHistoryTab('update') handler");
assert(html.includes("switchHistoryTab('remarks')"), "HTML includes switchHistoryTab('remarks') handler");

// ── 2. Script Execution in Sandbox ───────────────────────────────────────────
const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>[\s\S]*?<\/body>/);
assert(!!scriptMatch, "Found embedded script in Master page_21-Sep-2026.html");

const mockLocalStorage = {
  processadmin: "Lee, Mandy MY",
};

const elements = {};
function getMockElement(id) {
  if (!elements[id]) {
    elements[id] = {
      id,
      value: "",
      disabled: false,
      classList: {
        classes: new Set(["hidden"]),
        add(cls) { this.classes.add(cls); },
        remove(cls) { this.classes.delete(cls); },
        contains(cls) { return this.classes.has(cls); },
      },
      innerHTML: "",
      textContent: "",
      innerText: "",
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

const mockAuditLogsInDv = [
  {
    admin_caserecordid: "REC-100",
    admin_modifyfield: "PR No.",
    admin_existingvalue: "1111111",
    admin_newvalue: "2222222",
    admin_modifyby: "Wong, Peter",
    admin_whenmodify: "2026-10-10T09:00:00Z",
  },
];

const mockWebApi = {
  createRecord: async (entity, payload) => ({ id: "audit-1" }),
  updateRecord: async () => ({ id: "update-id" }),
  retrieveMultipleRecords: async (entity, query) => {
    if (entity.startsWith("admin_btb_audit_log")) {
      return { entities: mockAuditLogsInDv };
    }
    return { entities: [] };
  },
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
    querySelector() { return null; },
    addEventListener() {},
    removeEventListener() {},
    body: {
      classList: { add() {}, remove() {} },
      style: {},
    },
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
};

sandbox.globalThis = sandbox;
sandbox.window.window = sandbox.window;
sandbox.localStorage = sandbox.window.localStorage;
sandbox.location = sandbox.window.location;
sandbox.history = sandbox.window.history;

vm.createContext(sandbox);
vm.runInContext(scriptMatch[1], sandbox);

(async () => {
  // ── 3. Functions Exist ───────────────────────────────────────────────────────
  assert(typeof sandbox.openHistoryModal === "function", "openHistoryModal is defined");
  assert(typeof sandbox.closeHistoryModal === "function", "closeHistoryModal is defined");
  assert(typeof sandbox.refreshHistoryModal === "function", "refreshHistoryModal is defined");
  assert(typeof sandbox.fetchAuditLogsForRecord === "function", "fetchAuditLogsForRecord is defined");
  assert(typeof sandbox.deduplicateAuditLogs === "function", "deduplicateAuditLogs is defined");
  assert(typeof sandbox.renderHistoryTable === "function", "renderHistoryTable is defined");
  assert(typeof sandbox.switchHistoryTab === "function", "switchHistoryTab is defined");
  assert(typeof sandbox.isRemarkAuditLog === "function", "isRemarkAuditLog is defined");
  assert(typeof sandbox.updateHistoryTabUI === "function", "updateHistoryTabUI is defined");

  // ── 4. History Modal Open & Close ───────────────────────────────────────────
  const historyModal = getMockElement("historyModal");
  historyModal.classList.add("hidden");
  historyModal.classList.remove("flex");

  sandbox.state.currentRecord = {
    Id: "REC-100",
    Title: "REC-100",
    RecordIdNo: "REC-100",
    PRNo: "2222222",
  };

  await sandbox.openHistoryModal();
  assert(!historyModal.classList.contains("hidden"), "openHistoryModal removes 'hidden' class from historyModal");
  assert(historyModal.classList.contains("flex"), "openHistoryModal adds 'flex' class to historyModal");
  assert(getMockElement("history-modal-subtitle").innerText.includes("REC-100"), "history-modal-subtitle displays record ID");

  sandbox.closeHistoryModal();
  assert(historyModal.classList.contains("hidden"), "closeHistoryModal adds 'hidden' class to historyModal");
  assert(!historyModal.classList.contains("flex"), "closeHistoryModal removes 'flex' class from historyModal");

  // ── 5. renderHistoryTable with empty logs ───────────────────────────────────
  const tbody = getMockElement("history-records-tbody");
  sandbox.renderHistoryTable([]);
  assert(tbody.innerHTML.includes("No Change History Found"), "Empty logs render 'No Change History Found' notice");
  assert(getMockElement("history-modal-count").textContent === "0 record(s)", "Modal count shows '0 record(s)' for empty logs");

  // ── 6. renderHistoryTable with populated logs ────────────────────────────────
  const testLogs = [
    {
      admin_caserecordid: "REC-100",
      admin_modifyfield: "PR No.",
      admin_existingvalue: "6306168",
      admin_newvalue: "6306169",
      admin_modifyby: "Lee, Mandy MY",
      admin_whenmodify: "2026-10-16T12:00:00Z",
    },
    {
      admin_caserecordid: "REC-100",
      admin_modifyfield: "PO Amount",
      admin_existingvalue: "50000",
      admin_newvalue: "60000",
      admin_modifyby: "Lee, Mandy MY",
      admin_whenmodify: "2026-10-16T12:05:00Z",
    },
  ];

  sandbox.renderHistoryTable(testLogs);
  assert(tbody.innerHTML.includes("PR No."), "Table renders 'PR No.' field badge");
  assert(tbody.innerHTML.includes("6306168"), "Table renders previous value '6306168'");
  assert(tbody.innerHTML.includes("6306169"), "Table renders new value '6306169'");
  assert(tbody.innerHTML.includes("PO Amount"), "Table renders 'PO Amount' field badge");
  assert(tbody.innerHTML.includes("50000"), "Table renders previous value '50000'");
  assert(tbody.innerHTML.includes("60000"), "Table renders new value '60000'");
  assert(tbody.innerHTML.includes("Lee, Mandy MY"), "Table renders modifier 'Lee, Mandy MY'");
  assert(getMockElement("history-modal-count").textContent === "2 record(s)", "Modal count shows '2 record(s)'");

  // ── 7. fetchAuditLogsForRecord integrates in-memory and Dataverse logs ──────
  sandbox.state.auditLogs = [
    {
      admin_caserecordid: "REC-100",
      admin_modifyfield: "PR Amount",
      admin_existingvalue: "1000",
      admin_newvalue: "2000",
      admin_modifyby: "Lee, Mandy MY",
      admin_whenmodify: "2026-10-16T13:00:00Z",
    },
  ];

  const fetchedLogs = await sandbox.fetchAuditLogsForRecord("REC-100", "REC-100");
  assert(fetchedLogs.length === 2, "fetchAuditLogsForRecord combines Dataverse and in-memory logs");
  assert(fetchedLogs[0].admin_modifyfield === "PR Amount", "Logs are sorted newest first (in-memory at 13:00 before Dataverse at 09:00)");
  assert(fetchedLogs[1].admin_modifyfield === "PR No.", "Dataverse log included second");

  // ── 8. Update & Remarks Tabs Switching & Filtering ─────────────────────────
  const mixedLogs = [
    {
      admin_caserecordid: "REC-100",
      admin_modifyfield: "PR No.",
      admin_existingvalue: "6306168",
      admin_newvalue: "6306169",
      admin_modifyby: "Lee, Mandy MY",
      admin_whenmodify: "2026-10-16T12:00:00Z",
    },
    {
      admin_caserecordid: "REC-100",
      admin_modifyfield: "PO Amount",
      admin_existingvalue: "50000",
      admin_newvalue: "60000",
      admin_modifyby: "Lee, Mandy MY",
      admin_whenmodify: "2026-10-16T12:05:00Z",
    },
    {
      admin_caserecordid: "REC-100",
      admin_modifyfield: "Remark",
      admin_existingvalue: "Old remark note",
      admin_newvalue: "Updated quotation details for Cisco renewal",
      admin_modifyby: "Chan, Tai Man",
      admin_whenmodify: "2026-10-16T14:00:00Z",
    },
    {
      admin_caserecordid: "REC-100",
      admin_modifyfield: "Remarks",
      admin_existingvalue: "",
      admin_newvalue: "Additional LIS note added",
      admin_modifyby: "Wong, Peter",
      admin_whenmodify: "2026-10-16T14:30:00Z",
    },
  ];

  const thead = getMockElement("history-records-thead");
  const updateTabCount = getMockElement("history-tab-update-count");
  const remarksTabCount = getMockElement("history-tab-remarks-count");

  // Reset to update tab and render mixed logs
  sandbox.switchHistoryTab("update");
  sandbox.renderHistoryTable(mixedLogs);

  assert(updateTabCount.textContent === "2", "Update tab count badge displays 2");
  assert(remarksTabCount.textContent === "2", "Remarks tab count badge displays 2");
  assert(getMockElement("history-modal-count").textContent === "2 record(s)", "Modal count footer shows '2 record(s)' for Update tab");
  assert(thead.innerHTML.includes("Field") && thead.innerHTML.includes("Previous Value"), "Update thead includes 'Field' and 'Previous Value' headers");
  assert(tbody.innerHTML.includes("PR No.") && tbody.innerHTML.includes("PO Amount"), "Update tbody renders field update rows");
  assert(!tbody.innerHTML.includes("Updated quotation details for Cisco renewal"), "Update tbody does NOT render Remark row");

  // Switch to Remarks tab
  sandbox.switchHistoryTab("remarks");
  assert(getMockElement("history-modal-count").textContent === "2 record(s)", "Modal count footer shows '2 record(s)' for Remarks tab");
  assert(thead.innerHTML.includes("Date &amp; Time") || thead.innerHTML.includes("Date & Time"), "Remarks thead includes 'Date & Time'");
  assert(thead.innerHTML.includes("Contents"), "Remarks thead includes 'Contents'");
  assert(thead.innerHTML.includes("Created By"), "Remarks thead includes 'Created By'");
  assert(!thead.innerHTML.includes("Previous Value"), "Remarks thead does NOT include 'Previous Value'");
  assert(!thead.innerHTML.includes("Field"), "Remarks thead does NOT include 'Field'");
  assert(tbody.innerHTML.includes("Updated quotation details for Cisco renewal"), "Remarks tbody renders first Remark row");
  assert(tbody.innerHTML.includes("Additional LIS note added"), "Remarks tbody renders second Remark row");
  assert(tbody.innerHTML.includes("Chan, Tai Man") && tbody.innerHTML.includes("Wong, Peter"), "Remarks tbody renders modifiers");
  assert(!tbody.innerHTML.includes("PR No.") && !tbody.innerHTML.includes("PO Amount"), "Remarks tbody does NOT render non-remark update rows");

  // Switch to Remarks tab with empty remarks
  sandbox.renderHistoryTable(testLogs); // testLogs has 0 remarks
  assert(remarksTabCount.textContent === "0", "Remarks count badge is 0 when no remarks exist");
  assert(getMockElement("history-modal-count").textContent === "0 record(s)", "Modal count footer is '0 record(s)' for empty Remarks");
  assert(tbody.innerHTML.includes("No Remark History Found"), "Empty remarks render 'No Remark History Found' message");

  // Switch back to Update tab
  sandbox.switchHistoryTab("update");
  assert(getMockElement("history-modal-count").textContent === "2 record(s)", "Switching back to Update tab shows 2 records");
  assert(thead.innerHTML.includes("Field") && thead.innerHTML.includes("Previous Value"), "Update thead restored with 5 columns");

  // Verify openHistoryModal resets active tab to 'update'
  sandbox.switchHistoryTab("remarks");
  await sandbox.openHistoryModal();
  assert(thead.innerHTML.includes("Field") && thead.innerHTML.includes("Previous Value"), "openHistoryModal resets active tab to 'update'");

  // ── 9. Deduplication of Duplicate Remark Logs ──────────────────────────────
  const duplicateRemarkLogs = [
    {
      admin_caserecordid: "ATQ-202608-00203-V02-1",
      admin_modifyfield: "Remark",
      admin_whenmodify: "2026-10-20T01:09:01.428Z",
      admin_modifyby: "Chow, Alice SW",
      admin_newvalue: "Test\nTest\nTest\nTesr\nTestTestTest",
    },
    {
      admin_btb_audit_logid: "log-guid-1",
      admin_caserecordid: "ATQ-202608-00203-V02-1",
      admin_modifyfield: "Remark",
      admin_whenmodify: "2026-10-20T01:09:01Z",
      admin_modifyby: "Chow, Alice SW",
      admin_newvalue: "Test\nTest\nTest\nTesr\nTestTestTest",
    },
    {
      admin_btb_audit_logid: "log-guid-2",
      admin_caserecordid: "ATQ-202608-00203-V02-1",
      admin_modifyfield: "Remark",
      admin_whenmodify: "2026-10-16T04:32:00Z",
      admin_modifyby: "Fong, Josephine PH",
      admin_newvalue: "Test\nTest\nTest\nTesr\nTest",
    },
  ];

  const dedupedResult = sandbox.deduplicateAuditLogs(duplicateRemarkLogs);
  assert(dedupedResult.length === 2, "deduplicateAuditLogs reduces 3 logs with 1 duplicate to exactly 2 logs");
  assert(dedupedResult[0].admin_btb_audit_logid === "log-guid-1", "Preferred Dataverse record with server ID over in-memory duplicate");

  sandbox.switchHistoryTab("remarks");
  sandbox.renderHistoryTable(duplicateRemarkLogs);
  assert(remarksTabCount.textContent === "2", "Remarks tab count displays 2 (not 3) after deduplication");
  assert(getMockElement("history-modal-count").textContent === "2 record(s)", "Modal count footer displays '2 record(s)' (not 3)");

  console.log("\nALL HISTORY MODAL TESTS PASSED!");
})();
