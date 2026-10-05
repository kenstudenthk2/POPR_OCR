/* master-page-btbtype.test.js -- Verification for BTB / Non-BTB column showing admin_btbtype
   -----------------------------------------------------------------------------------------
   Verifies that Master page_21-Sep-2026.html correctly maps table "admin_btb_lis_excel_datas"
   column "admin_btbtype" to the table column "BTB / NON-BTB" (BTBType) and that the Manage
   modal opens cleanly.
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

// 1. Static markup verification
ok("HTML includes BTB / NON-BTB column configuration",
  HTML.includes('key: "BTBType"') && HTML.includes('admin_btbtype'));

ok("Edit modal carries edit-btb select field",
  HTML.includes('id="edit-btb"'));

ok("FIELD_ID_TO_RECORD_KEY maps edit-btb to BTBType",
  HTML.includes("'edit-btb': 'BTBType'"));

ok("Actions column has Manage button calling openEditModal",
  HTML.includes("openEditModal") && HTML.includes(">Manage</button>"));

// 2. Logic execution in sandbox
const scriptMatch = HTML.match(/<script>([\s\S]*?)<\/script>[\s\S]*?<\/body>/);
if (!scriptMatch) {
  console.error("FAIL: could not extract script block from " + HTML_PATH);
  process.exit(1);
}

let updatedRecords = [];
const mockEntities = [
  { admin_title: "REC-BTB-1", admin_btbtype: "BTB", admin_btb_lis_excel_datasid: "guid-1" },
  { admin_title: "REC-BTB-2", admin_btbtype: "NON-BTB", admin_btb_lis_excel_datasid: "guid-2" },
  { admin_title: "REC-BTB-3", admin_btbtype: "Non-BTB", admin_btb_lis_excel_datasid: "guid-3" },
  { admin_title: "REC-BTB-4", admin_btbtype: "Y", admin_btb_lis_excel_datasid: "guid-4" },
  { admin_title: "REC-BTB-5", admin_btbtype: "N", admin_btb_lis_excel_datasid: "guid-5" },
  { admin_title: "REC-BTB-6", admin_btbtype: null, admin_btb_lis_excel_datasid: "guid-6" },
  { admin_title: "REC-BTB-7", admin_btbtype: "", admin_btb_lis_excel_datasid: "guid-7" },
];

const mockWebApi = {
  retrieveMultipleRecords: async (entity, query) => ({
    entities: mockEntities
  }),
  updateRecord: async (entity, id, payload) => {
    updatedRecords.push({ entity, id, payload });
  }
};

const domElements = new Map();
function getMockElement(id) {
  if (!domElements.has(id)) {
    domElements.set(id, {
      id,
      innerText: "",
      value: id === "edit-currency" ? "HKD" : (id === "edit-pramount" ? "100" : ""),
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
      closest: () => ({ querySelector: () => ({ appendChild: () => {}, querySelector: () => null }) })
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
;EXPORTS.state = state;
EXPORTS.COLUMN_CONFIG = COLUMN_CONFIG;
EXPORTS.DV_COLUMN_MAP = DV_COLUMN_MAP;
EXPORTS.loadData = loadData;
EXPORTS.getBtbTag = getBtbTag;
EXPORTS.FIELD_ID_TO_RECORD_KEY = FIELD_ID_TO_RECORD_KEY;
EXPORTS.openEditModal = openEditModal;
EXPORTS.persistRecordToDataverse = typeof persistRecordToDataverse === 'function' ? persistRecordToDataverse : null;
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

// 3. Check COLUMN_CONFIG and DV_COLUMN_MAP
const btbCol = X.COLUMN_CONFIG.find(c => c.key === "BTBType");
ok("COLUMN_CONFIG has BTBType column", !!btbCol);
eq("BTBType column has label BTB / NON-BTB", btbCol?.label, "BTB / NON-BTB");
eq("DV_COLUMN_MAP maps admin_btbtype to BTBType", X.DV_COLUMN_MAP["admin_btbtype"], "BTBType");

// 4. Test getBtbTag display helper
const btbTag = X.getBtbTag("BTB");
ok("getBtbTag('BTB') returns charcoal pill with BTB", btbTag.includes("BTB") && btbTag.includes("var(--charcoal)"));

const nonBtbTag = X.getBtbTag("NON-BTB");
ok("getBtbTag('NON-BTB') returns orange pill with NON-BTB", nonBtbTag.includes("NON-BTB") && nonBtbTag.includes("var(--orange-dark)"));

const mixedCaseTag = X.getBtbTag("Non-BTB");
ok("getBtbTag('Non-BTB') returns orange pill with Non-BTB", mixedCaseTag.includes("Non-BTB") && mixedCaseTag.includes("var(--orange-dark)"));

const unsetTagNull = X.getBtbTag(null);
ok("getBtbTag(null) returns Unset", unsetTagNull.includes("Unset"));

const unsetTagEmpty = X.getBtbTag("");
ok("getBtbTag('') returns Unset", unsetTagEmpty.includes("Unset"));

// 5. Test loadData mappings from Dataverse
(async () => {
  await X.loadData();
  const records = X.state.allData;

  eq("loadData loaded 7 records", records.length, 7);

  eq("Record 1 with admin_btbtype='BTB' maps to BTBType='BTB'", records[0].BTBType, "BTB");
  eq("Record 2 with admin_btbtype='NON-BTB' maps to BTBType='NON-BTB'", records[1].BTBType, "NON-BTB");
  eq("Record 3 with admin_btbtype='Non-BTB' maps to BTBType='NON-BTB'", records[2].BTBType, "NON-BTB");
  eq("Record 4 with admin_btbtype='Y' maps to BTBType='BTB'", records[3].BTBType, "BTB");
  eq("Record 5 with admin_btbtype='N' maps to BTBType='NON-BTB'", records[4].BTBType, "NON-BTB");
  eq("Record 6 with admin_btbtype=null maps to BTBType=''", records[5].BTBType, "");
  eq("Record 7 with admin_btbtype='' maps to BTBType=''", records[6].BTBType, "");

  // 6. Test openEditModal execution (Manage button click)
  let modalOpenError = null;
  try {
    X.openEditModal("REC-BTB-1");
  } catch (err) {
    modalOpenError = err;
  }
  eq("openEditModal('REC-BTB-1') executed without throwing", modalOpenError, null);
  const editModalEl = getMockElement("editModal");
  ok("openEditModal unhid editModal element", !editModalEl.classList.contains("hidden") && editModalEl.classList.contains("flex"));

  // 7. Test Dataverse persistence if persistRecordToDataverse exists
  if (X.persistRecordToDataverse) {
    await X.persistRecordToDataverse({
      Id: "REC-BTB-1",
      Title: "REC-BTB-1",
      dataverseId: "guid-1",
      BTBType: "NON-BTB"
    });
    eq("Dataverse updateRecord was called", updatedRecords.length, 1);
    eq("Dataverse updateRecord payload has admin_btbtype", updatedRecords[0]?.payload?.admin_btbtype, "NON-BTB");
  }

  if (failures === 0) {
    console.log("\nALL CHECKS PASSED: BTB / Non-BTB column correctly shows admin_btbtype and Manage button works.");
    process.exit(0);
  } else {
    console.error(`\n${failures} check(s) failed.`);
    process.exit(1);
  }
})();
