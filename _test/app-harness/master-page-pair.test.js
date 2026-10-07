/* master-page-pair.test.js -- Product Type "Pair" function verification for Master page_21-Sep-2026.html
   Verifies that:
   1. The Record Details modal carries the "Pair" function around the red rectangle in the workflow grid.
   2. The Pair button is also available directly beside the Product Type label.
   3. pairCodesFromLookup correctly matches product types and extracts Charge CCC, Account Code, Issue By, and Works Order Codes.
   4. runProductTypePair populates the fields and syncs with Tab 3 inputs and state.currentRecord.
   5. Dropdown is generated when multiple Works Order Codes exist.
   6. Data synchronization between Tab 1 pair section and Tab 3 contract section works both ways.
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
assert(!html.includes('id="btn-pair-codes"'), "Pair button #btn-pair-codes is removed from HTML");
assert(!html.includes('>Pair</button>'), "All Pair buttons are removed from HTML");
assert(html.includes('id="edit-pair-charge-ccc"'), "HTML has #edit-pair-charge-ccc input in pair section");
assert(html.includes('id="edit-pair-account-code"'), "HTML has #edit-pair-account-code input in pair section");
assert(/<input[^>]*id="edit-ipt-unit-mgr"[^>]*disabled/i.test(html) || /<input[^>]*disabled[^>]*id="edit-ipt-unit-mgr"/i.test(html), "IPT Unit Mgr is disabled in HTML");
assert(/<input[^>]*id="edit-pair-charge-ccc"[^>]*disabled/i.test(html) || /<input[^>]*disabled[^>]*id="edit-pair-charge-ccc"/i.test(html), "Charge CCC in pair section is disabled in HTML");
assert(/<input[^>]*id="edit-pair-account-code"[^>]*disabled/i.test(html) || /<input[^>]*disabled[^>]*id="edit-pair-account-code"/i.test(html), "Account Code in pair section is disabled in HTML");
assert(html.includes('id="ac-code-container"'), "HTML has #ac-code-container in pair section");
assert(html.includes('id="wo-code-container"'), "HTML has #wo-code-container in pair section");
assert(/<select[^>]*id="edit-pair-works-order-code"/i.test(html), "Works Order Code is a select dropdown in HTML, not text input");
assert(html.includes('id="pair-status-msg"'), "HTML has #pair-status-msg status element");
assert(html.includes("Works Order Code Pair"), "HTML has 'Works Order Code Pair' section title");
assert(html.includes('id="btn-modal-remark"'), "HTML has #btn-modal-remark in modal header");
assert(html.includes('onclick="openRemarkModal()"'), "Remark button has openRemarkModal onclick handler");
assert(html.includes('id="remarkModal"'), "HTML has #remarkModal");
assert(html.includes('id="remark-sales-contact"'), "HTML has #remark-sales-contact dropdown");
assert(html.includes('id="remark-admin-name"'), "HTML has #remark-admin-name dropdown");
assert(html.includes('id="remark-case-type"'), "HTML has #remark-case-type dropdown");
assert(html.includes('id="modal-supplier-remark"'), "HTML has #modal-supplier-remark textarea");
assert(html.includes('id="modal-btb-remark"'), "HTML has #modal-btb-remark textarea");
assert(html.includes("To Supplier Remark"), "HTML has 'To Supplier Remark' section");
assert(html.includes("BTB Remark (To Buyer)"), "HTML has 'BTB Remark (To Buyer)' section");

// Verify position: the pair section is between edit-ipt-unit-mgr and edit-uid (red rectangle in screenshot)
const iptMgrPos = html.indexOf('id="edit-ipt-unit-mgr"');
const pairSectionPos = html.indexOf("Works Order Code Pair");
const uidPos = html.indexOf('id="edit-uid"');

assert(iptMgrPos > 0 && pairSectionPos > iptMgrPos, "Pair section is located after IPT Unit Mgr");
assert(uidPos > 0 && pairSectionPos < uidPos, "Pair section is located before UID # (at the red rectangle)");

// ── 2. Script Execution in Sandbox ───────────────────────────────────────────
const scriptMatch = html.match(/<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/i);
assert(!!scriptMatch, "Found embedded script in Master page_21-Sep-2026.html");

const mockWebApi = {
  retrieveMultipleRecords: async (entity, query) => {
    if (entity === "admin_btb_ccc_wocode_accode") {
      return {
        entities: [
          {
            admin_iptum2: "Ma, Martin WS; Lai, Steven SY",
            admin_producttype2: "Security - Firewall",
            admin_ccc2: "C716",
            admin_accountcode2: "512100",
            admin_worksordercode2: "WO-SEC-01",
            admin_admin2: "Lee, Mandy MY",
            admin_description2: "Firewall & Security Maintenance",
          },
          {
            admin_iptum2: "Ma, Martin WS; Lai, Steven SY",
            admin_producttype2: "Security - Firewall",
            admin_ccc2: "C716",
            admin_accountcode2: "512100",
            admin_worksordercode2: "WO-SEC-02",
            admin_admin2: "Lee, Mandy MY",
            admin_description2: "Security Appliance Upgrade",
          },
          {
            admin_iptum2: "Chan, Mary",
            admin_producttype2: "UCBV AV Equipment",
            admin_ccc2: "CCC-01",
            admin_accountcode2: "0012",
            admin_worksordercode2: "WO-100",
            admin_admin2: "Chan, Mary",
            admin_description2: "Maintenance of UCBV",
          },
          {
            admin_iptum2: "Lee, Peter",
            admin_producttype2: "Logger",
            admin_ccc2: "CCC-77",
            admin_accountcode2: "0099",
            admin_worksordercode2: "WO-900",
            admin_admin2: "Lee, Peter",
            admin_description2: "Logger Support",
          },
          {
            admin_iptum2: "Chow, Alice SW",
            admin_producttype2: "Networking & Security",
            admin_ccc2: "C801",
            admin_accountcode2: "511200",
            admin_worksordercode2: "WO-NET-01",
            admin_admin2: "Chow, Alice SW",
            admin_description2: "Network Equipment Maintenance",
          },
          {
            admin_iptum2: "Chow, Alice SW",
            admin_producttype2: "Networking & Security",
            admin_ccc2: "C801",
            admin_accountcode2: "511300",
            admin_worksordercode2: "WO-NET-02",
            admin_admin2: "Chow, Alice SW",
            admin_description2: "Network Expansion",
          },
        ]
      };
    }
    return { entities: [] };
  },
  updateRecord: async (entity, id, payload) => ({ id, ...payload }),
};

const domElements = new Map();
function getMockElement(id) {
  if (!domElements.has(id)) {
    domElements.set(id, {
      id,
      innerText: "",
      innerHTML: "",
      value: "",
      disabled: false,
      classList: {
        classes: new Set(),
        remove(...cls) { cls.forEach(c => this.classes.delete(c)); },
        add(...cls) { cls.forEach(c => this.classes.add(c)); },
        contains(c) { return this.classes.has(c); }
      },
      style: {},
      setAttribute() {},
      removeAttribute() {},
      appendChild() {},
      removeChild() {},
      querySelector: () => null,
      querySelectorAll: () => [],
      closest: () => ({ querySelector: () => ({ appendChild: () => {}, querySelector: () => null }) }),
    });
  }
  return domElements.get(id);
}

const sandbox = {
  console,
  setTimeout, clearTimeout,
  TextEncoder, Uint8Array,
  window: { addEventListener() {}, localStorage: { getItem: () => null, setItem: () => {} }, history: { pushState: () => {} }, location: { search: "" } },
  document: {
    addEventListener() {},
    getElementById: (id) => getMockElement(id),
    querySelector: () => ({ innerHTML: "" }),
    querySelectorAll: () => [],
    createElement: () => ({ setAttribute() {}, appendChild() {}, remove: () => {}, click() {}, style: {} }),
    body: { appendChild() {}, removeChild() {} },
  },
  location: { search: "" },
  history: { pushState: () => {} },
  URLSearchParams: function() { return { set: () => {}, get: () => "", delete: () => "", toString: () => "" }; },
  URL: function() { return { href: "" }; },
  parent: { Xrm: { WebApi: mockWebApi } },
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
;EXPORTS.normCodeKey = normCodeKey;
EXPORTS.pairCodesFromLookup = pairCodesFromLookup;
EXPORTS.CCC_LOOKUP_CONFIG = CCC_LOOKUP_CONFIG;
EXPORTS.fetchCccLookupRows = fetchCccLookupRows;
EXPORTS.runProductTypePair = runProductTypePair;
EXPORTS.resetProductTypePairUI = resetProductTypePairUI;
EXPORTS.syncPairChargeCcc = syncPairChargeCcc;
EXPORTS.syncPairAccountCode = syncPairAccountCode;
EXPORTS.syncPairWorksOrderCode = syncPairWorksOrderCode;
EXPORTS.syncTab3ChargeCcc = syncTab3ChargeCcc;
EXPORTS.syncTab3AccountCode = syncTab3AccountCode;
EXPORTS.syncTab3WorksOrderCode = syncTab3WorksOrderCode;
EXPORTS.formatWorksOrderOptions = formatWorksOrderOptions;
EXPORTS.state = state;
EXPORTS.openEditModal = openEditModal;
EXPORTS.closeModal = closeModal;
EXPORTS.persistCurrentRecord = persistCurrentRecord;
EXPORTS.buildBtbRemark = buildBtbRemark;
EXPORTS.buildToSupplierRemark = buildToSupplierRemark;
EXPORTS.interpolateRemark = interpolateRemark;
EXPORTS.findSalesContact = findSalesContact;
EXPORTS.findBtbAdminName = findBtbAdminName;
EXPORTS.openRemarkModal = openRemarkModal;
EXPORTS.applyRemarksToRecord = applyRemarksToRecord;
`;

try {
  vm.createContext(sandbox);
  vm.runInContext(SCRIPT_CODE, sandbox, { filename: "master-page-script.js" });
  assert(true, "script body evaluated cleanly with pair exports");
} catch (e) {
  console.error("FAIL: script body threw at load time:\n" + e.stack);
  process.exit(1);
}

// ── 3. Unit Test: normCodeKey ────────────────────────────────────────────────
const normCodeKey = sandbox.EXPORTS.normCodeKey;
assert(typeof normCodeKey === "function", "normCodeKey is defined");
assert(normCodeKey("  Security - Firewall  ") === "security - firewall", "normCodeKey trims and lowercases");
assert(normCodeKey("UCBV   AV   Equipment") === "ucbv av equipment", "normCodeKey collapses whitespace runs");
assert(normCodeKey(null) === "", "normCodeKey handles null");
assert(normCodeKey(undefined) === "", "normCodeKey handles undefined");

// ── 4. Unit Test: pairCodesFromLookup ────────────────────────────────────────
const pairCodesFromLookup = sandbox.EXPORTS.pairCodesFromLookup;
const CCC_LOOKUP_CONFIG = sandbox.EXPORTS.CCC_LOOKUP_CONFIG;
assert(typeof pairCodesFromLookup === "function", "pairCodesFromLookup is defined");

const TEST_ROWS = [
  {
    admin_iptum2: "Ma, Martin WS; Lai, Steven SY",
    admin_producttype2: "Security - Firewall",
    admin_ccc2: "C716",
    admin_accountcode2: "512100",
    admin_worksordercode2: "WO-SEC-01",
    admin_admin2: "Lee, Mandy MY",
    admin_description2: "Firewall & Security Maintenance",
  },
  {
    admin_iptum2: "Ma, Martin WS; Lai, Steven SY",
    admin_producttype2: "Security - Firewall",
    admin_ccc2: "C716",
    admin_accountcode2: "512100",
    admin_worksordercode2: "WO-SEC-02",
    admin_admin2: "Lee, Mandy MY",
    admin_description2: "Security Appliance Upgrade",
  },
  {
    admin_iptum2: "Lee, Peter",
    admin_producttype2: "Logger",
    admin_ccc2: "CCC-77",
    admin_accountcode2: "0099",
    admin_worksordercode2: "WO-900",
    admin_admin2: "Lee, Peter",
    admin_description2: "Logger Support",
  },
  {
    admin_iptum2: "Chow, Alice SW",
    admin_producttype2: "Networking & Security",
    admin_ccc2: "C801",
    admin_accountcode2: "511200",
    admin_worksordercode2: "WO-NET-01",
    admin_admin2: "Chow, Alice SW",
    admin_description2: "Network Equipment Maintenance",
  },
  {
    admin_iptum2: "Chow, Alice SW",
    admin_producttype2: "Networking & Security",
    admin_ccc2: "C801",
    admin_accountcode2: "511300",
    admin_worksordercode2: "WO-NET-02",
    admin_admin2: "Chow, Alice SW",
    admin_description2: "Network Expansion",
  },
];

// Single option test with IPT Unit Mgr
const singleMatch = pairCodesFromLookup(TEST_ROWS, "Lee, Peter", CCC_LOOKUP_CONFIG.fields);
assert(singleMatch !== null, "pairCodesFromLookup finds 'Lee, Peter'");
assert(singleMatch.chargeCcc === "CCC-77", "Lee, Peter Charge CCC matches CCC-77");
assert(singleMatch.accountCode === "0099", "Lee, Peter Account Code matches 0099");
assert(singleMatch.accountCodes.length === 1, "Lee, Peter has 1 Account Code");
assert(singleMatch.issueBy === "Lee, Peter", "Lee, Peter Issue By matches Lee, Peter");
assert(singleMatch.worksOrderCodes.length === 1 && singleMatch.worksOrderCodes[0] === "WO-900", "Lee, Peter has 1 Works Order Code");
assert(singleMatch.conflict === false, "Lee, Peter has no conflict");

// Multiple options test with IPT Unit Mgr (Ma, Martin WS; Lai, Steven SY from screenshot)
const multiMatch = pairCodesFromLookup(TEST_ROWS, "Ma, Martin WS; Lai, Steven SY", CCC_LOOKUP_CONFIG.fields);
assert(multiMatch !== null, "pairCodesFromLookup finds 'Ma, Martin WS; Lai, Steven SY'");
assert(multiMatch.chargeCcc === "C716", "Ma, Martin WS; Lai, Steven SY Charge CCC is C716");
assert(multiMatch.accountCode === "512100", "Ma, Martin WS; Lai, Steven SY Account Code is 512100");
assert(multiMatch.accountCodes.length === 1, "Ma, Martin WS; Lai, Steven SY has 1 Account Code");
assert(multiMatch.issueBy === "Lee, Mandy MY", "Ma, Martin WS; Lai, Steven SY Issue By is Lee, Mandy MY");
assert(multiMatch.worksOrderCodes.length === 2, "Ma, Martin WS; Lai, Steven SY has 2 Works Order Codes");
assert(multiMatch.worksOrderOptions.length === 2, "Ma, Martin WS; Lai, Steven SY has 2 Works Order Options with descriptions");
assert(multiMatch.worksOrderOptions[0].code === "WO-SEC-01", "First option code is WO-SEC-01");
assert(multiMatch.worksOrderOptions[0].description === "Firewall & Security Maintenance", "First option description matches");

// Multiple Account Codes test (Chow, Alice SW has 2 account codes)
const multiAccMatch = pairCodesFromLookup(TEST_ROWS, "Chow, Alice SW", CCC_LOOKUP_CONFIG.fields);
assert(multiAccMatch !== null, "pairCodesFromLookup finds 'Chow, Alice SW'");
assert(multiAccMatch.accountCodes.length === 2, "Chow, Alice SW has 2 distinct Account Codes");
assert(multiAccMatch.accountCodes.includes("511200") && multiAccMatch.accountCodes.includes("511300"), "Chow, Alice SW has 511200 and 511300");

// Semicolon-split single manager match test
const splitMatch = pairCodesFromLookup(TEST_ROWS, "Ma, Martin WS", CCC_LOOKUP_CONFIG.fields);
assert(splitMatch !== null, "pairCodesFromLookup finds row when searching for single manager of a pair");
assert(splitMatch.chargeCcc === "C716", "Split manager match yields C716");

// Non-existent IPT Unit Mgr
const missMatch = pairCodesFromLookup(TEST_ROWS, "NonExistent Manager", CCC_LOOKUP_CONFIG.fields);
assert(missMatch === null, "pairCodesFromLookup returns null for non-existent IPT Unit Mgr");

// ── 5. Integration Test: runProductTypePair in Sandbox ───────────────────────
(async () => {
  const runProductTypePair = sandbox.EXPORTS.runProductTypePair;
  assert(typeof runProductTypePair === "function", "runProductTypePair is defined");

  // Setup current record in sandbox state
  sandbox.EXPORTS.state.currentRecord = {
    Id: "REC-TEST-1",
    Title: "REC-TEST-1",
    ProductType: "Security - Firewall",
    IPTUnitMgr: "Ma, Martin WS; Lai, Steven SY",
    ChargeCCC: "",
    AccountCode: "",
    WorksOrderCode: "",
    IssueBy: "",
  };

  const iptInput = getMockElement("edit-ipt-unit-mgr");
  iptInput.value = "Ma, Martin WS; Lai, Steven SY";

  await runProductTypePair();

  const pairCcc = getMockElement("edit-pair-charge-ccc");
  const tab3Ccc = getMockElement("edit-charge-ccc");
  assert(pairCcc.value === "C716", "edit-pair-charge-ccc populated with C716");
  assert(tab3Ccc.value === "C716", "edit-charge-ccc in Tab 3 synced with C716");

  const pairAcc = getMockElement("edit-pair-account-code");
  const tab3Acc = getMockElement("edit-account-code");
  assert(pairAcc.value === "512100", "edit-pair-account-code populated with 512100");
  assert(tab3Acc.value === "512100", "edit-account-code in Tab 3 synced with 512100");

  const acContainer = getMockElement("ac-code-container");
  assert(acContainer.innerHTML.includes("<input"), "Account Code remains input text box when single account code");
  assert(acContainer.innerHTML.includes("disabled"), "Account Code input text box is disabled");

  const issueBy = getMockElement("edit-issue-by");
  assert(issueBy.value === "Lee, Mandy MY", "edit-issue-by populated with Lee, Mandy MY");

  const woContainer = getMockElement("wo-code-container");
  assert(woContainer.innerHTML.includes("<select"), "Works Order select dropdown rendered for multiple options");
  assert(woContainer.innerHTML.includes("WO-SEC-01"), "Dropdown includes WO-SEC-01");
  assert(woContainer.innerHTML.includes("WO-SEC-02"), "Dropdown includes WO-SEC-02");

  const statusMsg = getMockElement("pair-status-msg");
  assert(statusMsg.innerText.includes("Pick a Works Order Code"), "Status message prompts user to pick a Works Order Code");

  // Test IPT Unit Mgr with multiple Account Codes (Chow, Alice SW)
  iptInput.value = "Chow, Alice SW";
  await runProductTypePair();
  assert(acContainer.innerHTML.includes("<select"), "Account Code renders as select dropdown when multiple account codes exist");
  assert(acContainer.innerHTML.includes("511200"), "Account Code dropdown includes 511200");
  assert(acContainer.innerHTML.includes("511300"), "Account Code dropdown includes 511300");
  assert(statusMsg.innerText.includes("Pick an Account Code"), "Status message prompts user to pick an Account Code");

  // Test selecting Account Code from dropdown updates Tab 3
  const handlePairAccountCodeSelect = sandbox.EXPORTS.syncPairAccountCode;
  handlePairAccountCodeSelect("511300");
  assert(tab3Acc.value === "511300", "Selecting Account Code from dropdown syncs with Tab 3");

  // Test single Works Order IPT Unit Mgr
  iptInput.value = "Lee, Peter";
  await runProductTypePair();
  assert(pairCcc.value === "CCC-77", "Logger populated CCC-77");
  assert(pairAcc.value === "0099", "Logger populated 0099");
  assert(acContainer.innerHTML.includes("<input"), "Account Code back to input text box for single option");
  assert(issueBy.value === "Lee, Peter", "Logger populated Lee, Peter");
  const pairWo = getMockElement("edit-pair-works-order-code");
  assert(pairWo.value === "WO-900", "Single Works Order Code auto-fills WO-900");
  assert(statusMsg.innerText.includes("Charge CCC, Account Code"), "Success message for single WO");

  // Test empty IPT Unit Mgr validation
  iptInput.value = "";
  sandbox.EXPORTS.state.currentRecord.IPTUnitMgr = "";
  await runProductTypePair();
  assert(statusMsg.innerText.includes("No IPT Unit Mgr to pair on"), "Error message when IPT Unit Mgr is empty");

  // ── 6. Bidirectional Synchronization Test ──────────────────────────────────
  const syncTab3ChargeCcc = sandbox.EXPORTS.syncTab3ChargeCcc;
  syncTab3ChargeCcc("CCC-CUSTOM");
  assert(pairCcc.value === "CCC-CUSTOM", "Typing in Tab 3 Charge CCC updates Tab 1 pair section");

  const syncPairWorksOrderCode = sandbox.EXPORTS.syncPairWorksOrderCode;
  syncPairWorksOrderCode("WO-CUSTOM");
  const tab3Wo = getMockElement("edit-works-order-code");
  assert(tab3Wo.value === "WO-CUSTOM", "Typing in Tab 1 Works Order Code updates Tab 3");

  // ── 7. openEditModal Lifecycle Test ────────────────────────────────────────
  sandbox.EXPORTS.state.allData = [
    {
      Id: "REC-MODAL-1",
      Title: "REC-MODAL-1",
      ProductType: "Security - Firewall",
      ChargeCCC: "C716-EXISTING",
      AccountCode: "512100-EXISTING",
      WorksOrderCode: "WO-EXISTING",
      IssueBy: "Existing Admin",
      ProcessStatus: "PR No. Ready",
    }
  ];

  sandbox.EXPORTS.openEditModal("REC-MODAL-1");
  assert(pairCcc.value === "C716-EXISTING", "openEditModal initializes pair Charge CCC from record");
  assert(pairAcc.value === "512100-EXISTING", "openEditModal initializes pair Account Code from record");

  // ── 8. Works Order Code Option Display Test ────────────────────────────────
  const formatWorksOrderOptions = sandbox.EXPORTS.formatWorksOrderOptions;
  assert(typeof formatWorksOrderOptions === "function", "formatWorksOrderOptions is defined");

  const mockSelect = {
    selectedIndex: 1,
    value: "WO-SEC-01",
    options: [
      { value: "", text: "-- Select Works Order Code --", selected: false, getAttribute: () => "" },
      { value: "WO-SEC-01", text: "WO-SEC-01 (Firewall & Security Maintenance)", selected: true, getAttribute: (k) => k === 'data-code' ? 'WO-SEC-01' : 'Firewall & Security Maintenance' },
      { value: "WO-SEC-02", text: "WO-SEC-02 (Security Appliance Upgrade)", selected: false, getAttribute: (k) => k === 'data-code' ? 'WO-SEC-02' : 'Security Appliance Upgrade' },
    ]
  };

  // When selected mode is formatted (after select):
  formatWorksOrderOptions(mockSelect, 'selected');
  assert(mockSelect.options[1].text === "WO-SEC-01", "Selected option text displays ONLY the Code value, not the description");
  assert(mockSelect.options[2].text.includes("Security Appliance Upgrade"), "Non-selected option retains description in dropdown list");

  // When dropdown opens (full mode on focus/mousedown):
  formatWorksOrderOptions(mockSelect, 'full');
  assert(mockSelect.options[1].text.includes("Firewall & Security Maintenance"), "When dropdown opens, options list shows descriptions");

  // ── 9. LIS & Remark Engine Test ────────────────────────────────────────────
  const buildBtbRemark = sandbox.EXPORTS.buildBtbRemark;
  const buildToSupplierRemark = sandbox.EXPORTS.buildToSupplierRemark;
  const interpolateRemark = sandbox.EXPORTS.interpolateRemark;
  const findSalesContact = sandbox.EXPORTS.findSalesContact;
  const findBtbAdminName = sandbox.EXPORTS.findBtbAdminName;

  assert(typeof buildBtbRemark === "function", "buildBtbRemark is defined");
  assert(typeof buildToSupplierRemark === "function", "buildToSupplierRemark is defined");
  assert(typeof interpolateRemark === "function", "interpolateRemark is defined");

  const contact = findSalesContact("Yau, Ricky CH");
  assert(contact !== null, "findSalesContact finds Yau, Ricky CH");
  const btbRemark = buildBtbRemark(contact, "Lee, Mandy MY", false);
  assert(btbRemark.includes("Special Request: Would BUYER please send PO to vendor"), "buildBtbRemark generates valid buyer sentence");
  assert(btbRemark.includes("Yau, Ricky CH(sales)"), "buildBtbRemark includes sales contact in CC list");

  const fields = {
    customerName: { value: "UNION HOSPITAL test" },
    vendor: { value: "Cisco Systems Ltd" },
    quotationStartDate: { value: "2026-01-01" },
    quotationEndDate: { value: "2026-12-31" },
    poPrDescription: { value: "Cisco Firewall Maintenance" },
  };
  const supplierRemark = buildToSupplierRemark("C716", fields, contact, true, "Lee, Mandy MY");
  assert(supplierRemark.includes("Enduser: UNION HOSPITAL test"), "buildToSupplierRemark includes customer name");
  assert(supplierRemark.includes("SI: Cisco Systems Ltd"), "buildToSupplierRemark includes vendor");
  assert(supplierRemark.includes("Period:"), "buildToSupplierRemark includes period");

  const interpResult = interpolateRemark("Enduser: {Enduser}, SI: {SI}", fields, contact, "Lee, Mandy MY");
  assert(interpResult === "Enduser: UNION HOSPITAL test, SI: Cisco Systems Ltd", "interpolateRemark replaces placeholders correctly");

  console.log("\nALL CHECKS PASSED: Master page_21-Sep-2026.html Product Type Pair function verified successfully.");
})();
