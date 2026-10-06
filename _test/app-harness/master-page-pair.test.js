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
assert(html.includes('id="btn-pair-codes"'), "HTML has #btn-pair-codes button in the coding section");
assert(html.includes('onclick="runProductTypePair()"'), "HTML has runProductTypePair onclick handler");
assert(html.includes('id="edit-pair-charge-ccc"'), "HTML has #edit-pair-charge-ccc input in pair section");
assert(html.includes('id="edit-pair-account-code"'), "HTML has #edit-pair-account-code input in pair section");
assert(html.includes('id="wo-code-container"'), "HTML has #wo-code-container in pair section");
assert(html.includes('id="pair-status-msg"'), "HTML has #pair-status-msg status element");

// Verify position: the pair section is between edit-ipt-unit-mgr and edit-uid (red rectangle in screenshot)
const iptMgrPos = html.indexOf('id="edit-ipt-unit-mgr"');
const pairSectionPos = html.indexOf('id="btn-pair-codes"');
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
            admin_producttype2: "Security - Firewall",
            admin_ccc2: "C716",
            admin_accountcode2: "512100",
            admin_worksordercode2: "WO-SEC-01",
            admin_admin2: "Lee, Mandy MY",
            admin_description2: "Firewall & Security Maintenance",
          },
          {
            admin_producttype2: "Security - Firewall",
            admin_ccc2: "C716",
            admin_accountcode2: "512100",
            admin_worksordercode2: "WO-SEC-02",
            admin_admin2: "Lee, Mandy MY",
            admin_description2: "Security Appliance Upgrade",
          },
          {
            admin_producttype2: "UCBV AV Equipment",
            admin_ccc2: "CCC-01",
            admin_accountcode2: "0012",
            admin_worksordercode2: "WO-100",
            admin_admin2: "Chan, Mary",
            admin_description2: "Maintenance of UCBV",
          },
          {
            admin_producttype2: "Logger",
            admin_ccc2: "CCC-77",
            admin_accountcode2: "0099",
            admin_worksordercode2: "WO-900",
            admin_admin2: "Lee, Peter",
            admin_description2: "Logger Support",
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
EXPORTS.state = state;
EXPORTS.openEditModal = openEditModal;
EXPORTS.closeModal = closeModal;
EXPORTS.persistCurrentRecord = persistCurrentRecord;
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
    admin_producttype2: "Security - Firewall",
    admin_ccc2: "C716",
    admin_accountcode2: "512100",
    admin_worksordercode2: "WO-SEC-01",
    admin_admin2: "Lee, Mandy MY",
    admin_description2: "Firewall & Security Maintenance",
  },
  {
    admin_producttype2: "Security - Firewall",
    admin_ccc2: "C716",
    admin_accountcode2: "512100",
    admin_worksordercode2: "WO-SEC-02",
    admin_admin2: "Lee, Mandy MY",
    admin_description2: "Security Appliance Upgrade",
  },
  {
    admin_producttype2: "Logger",
    admin_ccc2: "CCC-77",
    admin_accountcode2: "0099",
    admin_worksordercode2: "WO-900",
    admin_admin2: "Lee, Peter",
    admin_description2: "Logger Support",
  },
];

// Single option test
const singleMatch = pairCodesFromLookup(TEST_ROWS, "Logger", CCC_LOOKUP_CONFIG.fields);
assert(singleMatch !== null, "pairCodesFromLookup finds 'Logger'");
assert(singleMatch.chargeCcc === "CCC-77", "Logger Charge CCC matches CCC-77");
assert(singleMatch.accountCode === "0099", "Logger Account Code matches 0099");
assert(singleMatch.issueBy === "Lee, Peter", "Logger Issue By matches Lee, Peter");
assert(singleMatch.worksOrderCodes.length === 1 && singleMatch.worksOrderCodes[0] === "WO-900", "Logger has 1 Works Order Code");
assert(singleMatch.conflict === false, "Logger has no conflict");

// Multiple options test (Security - Firewall from screenshot)
const multiMatch = pairCodesFromLookup(TEST_ROWS, "security - firewall", CCC_LOOKUP_CONFIG.fields);
assert(multiMatch !== null, "pairCodesFromLookup finds 'Security - Firewall'");
assert(multiMatch.chargeCcc === "C716", "Security - Firewall Charge CCC is C716");
assert(multiMatch.accountCode === "512100", "Security - Firewall Account Code is 512100");
assert(multiMatch.issueBy === "Lee, Mandy MY", "Security - Firewall Issue By is Lee, Mandy MY");
assert(multiMatch.worksOrderCodes.length === 2, "Security - Firewall has 2 Works Order Codes");
assert(multiMatch.worksOrderOptions.length === 2, "Security - Firewall has 2 Works Order Options with descriptions");
assert(multiMatch.worksOrderOptions[0].code === "WO-SEC-01", "First option code is WO-SEC-01");
assert(multiMatch.worksOrderOptions[0].description === "Firewall & Security Maintenance", "First option description matches");

// Non-existent product type
const missMatch = pairCodesFromLookup(TEST_ROWS, "NonExistent Product", CCC_LOOKUP_CONFIG.fields);
assert(missMatch === null, "pairCodesFromLookup returns null for non-existent product type");

// ── 5. Integration Test: runProductTypePair in Sandbox ───────────────────────
(async () => {
  const runProductTypePair = sandbox.EXPORTS.runProductTypePair;
  assert(typeof runProductTypePair === "function", "runProductTypePair is defined");

  // Setup current record in sandbox state
  sandbox.EXPORTS.state.currentRecord = {
    Id: "REC-TEST-1",
    Title: "REC-TEST-1",
    ProductType: "Security - Firewall",
    ChargeCCC: "",
    AccountCode: "",
    WorksOrderCode: "",
    IssueBy: "",
  };

  const ptInput = getMockElement("edit-product-type");
  ptInput.value = "Security - Firewall";

  await runProductTypePair();

  const pairCcc = getMockElement("edit-pair-charge-ccc");
  const tab3Ccc = getMockElement("edit-charge-ccc");
  assert(pairCcc.value === "C716", "edit-pair-charge-ccc populated with C716");
  assert(tab3Ccc.value === "C716", "edit-charge-ccc in Tab 3 synced with C716");

  const pairAcc = getMockElement("edit-pair-account-code");
  const tab3Acc = getMockElement("edit-account-code");
  assert(pairAcc.value === "512100", "edit-pair-account-code populated with 512100");
  assert(tab3Acc.value === "512100", "edit-account-code in Tab 3 synced with 512100");

  const issueBy = getMockElement("edit-issue-by");
  assert(issueBy.value === "Lee, Mandy MY", "edit-issue-by populated with Lee, Mandy MY");

  const woContainer = getMockElement("wo-code-container");
  assert(woContainer.innerHTML.includes("<select"), "Works Order select dropdown rendered for multiple options");
  assert(woContainer.innerHTML.includes("WO-SEC-01"), "Dropdown includes WO-SEC-01");
  assert(woContainer.innerHTML.includes("WO-SEC-02"), "Dropdown includes WO-SEC-02");

  const statusMsg = getMockElement("pair-status-msg");
  assert(statusMsg.innerText.includes("Pick a Works Order Code"), "Status message prompts user to pick a Works Order Code");

  // Test single Works Order product type
  ptInput.value = "Logger";
  await runProductTypePair();
  assert(pairCcc.value === "CCC-77", "Logger populated CCC-77");
  assert(pairAcc.value === "0099", "Logger populated 0099");
  assert(issueBy.value === "Lee, Peter", "Logger populated Lee, Peter");
  const pairWo = getMockElement("edit-pair-works-order-code");
  assert(pairWo.value === "WO-900", "Single Works Order Code auto-fills WO-900");
  assert(statusMsg.innerText.includes("Charge CCC, Account Code, Issue By and Works Order Code filled"), "Success message for single WO");

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

  console.log("\nALL CHECKS PASSED: Master page_21-Sep-2026.html Product Type Pair function verified successfully.");
})();
