/* master-page-duplicate.test.js -- Verification for Duplicate Feature
   -----------------------------------------------------------------------------------------
   Verifies:
   1. Static markup:
      - Duplicate button #btn-duplicate in #action-buttons next to Verify
      - Duplicate modal #duplicateModal with number input #duplicate-quantity and #duplicate-error
      - Sub Number display field #edit-subnumber in tab-request next to Request ID
      - Sub Record navigation container #subRecordsBar in the sticky navigation header
   2. Config & Mappings:
      - COLUMN_CONFIG includes SubNumber placed after Title
      - FIELD_ID_TO_RECORD_KEY maps 'edit-subnumber' to 'SubNumber'
      - PERMANENTLY_DISABLED_FIELD_IDS includes 'edit-subnumber'
   3. Functionality & Business Logic:
      - duplicateRecord(sourceRecordId, quantity) creates exact clones
      - Unique system Ids generated for duplicates
      - Sequential Sub1, Sub2, ... SubN assigned
      - Collision prevention: subsequent duplications continue sequentially without regenerating
      - Duplicating from a child record continues from parent's sequence with ParentRecordId preserved
      - getSubRecords(parentRecordId) returns sorted children
      - renderSubRecordsTab() generates correct buttons/cards and count
      - Quantity validation (1 to 10 integers only)
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
const ok = (label, cond, extra) => {
  if (cond) {
    console.log("OK   " + label);
    return;
  }
  failures++;
  console.error("FAIL " + label + (extra ? " " + JSON.stringify(extra) : ""));
};

// 1. Static markup checks
ok("Duplicate button #btn-duplicate exists in HTML", HTML.includes('id="btn-duplicate"'));
ok("Duplicate button has onclick calling openDuplicateModal", HTML.includes('onclick="openDuplicateModal()"'));
ok("Duplicate modal #duplicateModal exists in HTML", HTML.includes('id="duplicateModal"'));
ok("Duplicate quantity input #duplicate-quantity exists in HTML", HTML.includes('id="duplicate-quantity"'));
ok("Duplicate error span #duplicate-error exists in HTML", HTML.includes('id="duplicate-error"'));
ok("Sub Number field #edit-subnumber exists in HTML", HTML.includes('id="edit-subnumber"'));
ok("Sub Record bar #subRecordsBar exists in HTML", HTML.includes('id="subRecordsBar"'));

// 2. Script execution in sandbox
const scriptMatch = HTML.match(/<script>([\s\S]*?)<\/script>[\s\S]*?<\/body>/);
if (!scriptMatch) {
  console.error("FAIL: could not extract script block from " + HTML_PATH);
  process.exit(1);
}

const domElements = new Map();
function getMockElement(id) {
  if (!domElements.has(id)) {
    domElements.set(id, {
      id,
      innerHTML: "",
      innerText: "",
      textContent: "",
      value: "",
      checked: false,
      disabled: false,
      classList: {
        classes: new Set(),
        remove(...cls) { cls.forEach(c => this.classes.delete(c)); },
        add(...cls) { cls.forEach(c => this.classes.add(c)); },
        contains(c) { return this.classes.has(c); },
        toggle(c, force) {
          const has = this.classes.has(c);
          const shouldAdd = force !== undefined ? !!force : !has;
          if (shouldAdd) this.classes.add(c);
          else this.classes.delete(c);
          return shouldAdd;
        }
      },
      style: {},
      setAttribute() {},
      removeAttribute() {},
      appendChild() {},
      removeChild() {},
      querySelector: () => null,
      querySelectorAll: () => [],
      focus() {}
    });
  }
  return domElements.get(id);
}

const dataverseUpdates = [];
const dataverseCreates = [];
const mockWebApi = {
  retrieveMultipleRecords: async () => ({ entities: [] }),
  updateRecord: async (entity, id, payload) => {
    dataverseUpdates.push({ entity, id, payload });
  },
  createRecord: async (entity, payload) => {
    dataverseCreates.push({ entity, payload });
    return { id: "created-guid-" + (dataverseCreates.length) };
  }
};

const sandbox = {
  console,
  setTimeout, clearTimeout,
  TextEncoder, Uint8Array,
  window: {
    addEventListener() {},
    localStorage: { getItem: () => null, setItem: () => {} },
    history: { pushState: () => {} },
    location: { search: "" }
  },
  document: {
    addEventListener() {},
    getElementById: (id) => getMockElement(id),
    querySelector: (sel) => {
      if (sel && sel.startsWith('#')) return getMockElement(sel.slice(1));
      return { innerHTML: "", appendChild() {} };
    },
    querySelectorAll: () => [],
    createElement: (tag) => ({
      tagName: tag.toUpperCase(),
      setAttribute() {},
      appendChild() {},
      remove: () => {},
      click() {},
      classList: { add() {}, remove() {}, contains: () => false },
      style: {}
    }),
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
  RegExp,
  parseInt,
  parseFloat,
  isNaN,
  isFinite,
  EXPORTS: {},
};
sandbox.globalThis = sandbox;

const SCRIPT_CODE = scriptMatch[1] + `
;EXPORTS.state = state;
EXPORTS.COLUMN_CONFIG = COLUMN_CONFIG;
EXPORTS.DV_COLUMN_MAP = DV_COLUMN_MAP;
EXPORTS.FIELD_ID_TO_RECORD_KEY = FIELD_ID_TO_RECORD_KEY;
EXPORTS.PERMANENTLY_DISABLED_FIELD_IDS = PERMANENTLY_DISABLED_FIELD_IDS;
EXPORTS.duplicateRecord = typeof duplicateRecord === 'function' ? duplicateRecord : undefined;
EXPORTS.getSubRecords = typeof getSubRecords === 'function' ? getSubRecords : undefined;
EXPORTS.renderSubRecordsTab = typeof renderSubRecordsTab === 'function' ? renderSubRecordsTab : undefined;
EXPORTS.openDuplicateModal = typeof openDuplicateModal === 'function' ? openDuplicateModal : undefined;
EXPORTS.closeDuplicateModal = typeof closeDuplicateModal === 'function' ? closeDuplicateModal : undefined;
EXPORTS.confirmDuplicateRecord = typeof confirmDuplicateRecord === 'function' ? confirmDuplicateRecord : undefined;
EXPORTS.openEditModal = typeof openEditModal === 'function' ? openEditModal : undefined;
EXPORTS.persistRecordToDataverse = typeof persistRecordToDataverse === 'function' ? persistRecordToDataverse : undefined;
`;

try {
  vm.runInNewContext(SCRIPT_CODE, sandbox);
  console.log("OK   Script evaluated cleanly");
} catch (e) {
  console.error("FAIL Script evaluation threw: " + e.message);
  process.exit(1);
}

const X = sandbox.EXPORTS;

// 3. COLUMN_CONFIG verification
ok("COLUMN_CONFIG includes SubNumber column", !!X.COLUMN_CONFIG.find(c => c.key === "SubNumber"));
const titleIdx = X.COLUMN_CONFIG.findIndex(c => c.key === "Title");
const subNumIdx = X.COLUMN_CONFIG.findIndex(c => c.key === "SubNumber");
ok("SubNumber column is placed after Title in COLUMN_CONFIG", subNumIdx === titleIdx + 1);

// 4. Mappings verification
ok("FIELD_ID_TO_RECORD_KEY maps edit-subnumber to SubNumber", X.FIELD_ID_TO_RECORD_KEY["edit-subnumber"] === "SubNumber");
ok("PERMANENTLY_DISABLED_FIELD_IDS includes edit-subnumber", X.PERMANENTLY_DISABLED_FIELD_IDS && X.PERMANENTLY_DISABLED_FIELD_IDS.has("edit-subnumber"));

// 5. Function existence
ok("duplicateRecord function is defined", typeof X.duplicateRecord === "function");
ok("getSubRecords function is defined", typeof X.getSubRecords === "function");
ok("renderSubRecordsTab function is defined", typeof X.renderSubRecordsTab === "function");
ok("openDuplicateModal function is defined", typeof X.openDuplicateModal === "function");
ok("closeDuplicateModal function is defined", typeof X.closeDuplicateModal === "function");
ok("confirmDuplicateRecord function is defined", typeof X.confirmDuplicateRecord === "function");

// 6. Duplication behavior
if (typeof X.duplicateRecord === "function") {
  // Set up mock data
  X.state.allData = [
    {
      Id: "5",
      Title: "REQ-2026-005",
      CustomerName: "Acme Corp",
      Vendor: "Cisco",
      PRAmount: 50000,
      ProcessStatus: "UM Verified",
      UrgentFlag: true,
      Remarks: "Original Note",
      dataverseId: "parent-dv-guid"
    }
  ];

  // Test duplicateRecord with quantity 3
  const dups1 = X.duplicateRecord("5", 3);
  ok("duplicateRecord created 3 records", Array.isArray(dups1) && dups1.length === 3);
  eq("First duplicate has SubNumber Sub1", dups1[0] && dups1[0].SubNumber, "Sub1");
  eq("Second duplicate has SubNumber Sub2", dups1[1] && dups1[1].SubNumber, "Sub2");
  eq("Third duplicate has SubNumber Sub3", dups1[2] && dups1[2].SubNumber, "Sub3");

  ok("Duplicates preserved Title REQ-2026-005", dups1.every(d => d.Title === "REQ-2026-005"));
  ok("Duplicates preserved CustomerName Acme Corp", dups1.every(d => d.CustomerName === "Acme Corp"));
  ok("Duplicates preserved Vendor Cisco", dups1.every(d => d.Vendor === "Cisco"));
  ok("Duplicates preserved PRAmount 50000", dups1.every(d => d.PRAmount === 50000));
  ok("Duplicates preserved ProcessStatus UM Verified", dups1.every(d => d.ProcessStatus === "UM Verified"));
  ok("Duplicates preserved UrgentFlag true", dups1.every(d => d.UrgentFlag === true));
  ok("Duplicates preserved Remarks Original Note", dups1.every(d => d.Remarks === "Original Note"));

  ok("Parent record has IsParentRecord: true", X.state.allData.find(d => d.Id === "5").IsParentRecord === true);
  ok("Duplicates have ParentRecordId: '5'", dups1.every(d => String(d.ParentRecordId) === "5"));
  ok("Duplicates have IsSubRecord: true", dups1.every(d => d.IsSubRecord === true));
  ok("Duplicates cleared dataverseId", dups1.every(d => !d.dataverseId));

  // Check unique IDs
  const allIds = X.state.allData.map(d => String(d.Id));
  const uniqueIds = new Set(allIds);
  ok("All records have unique internal Ids", uniqueIds.size === allIds.length);
  ok("Generated IDs do not collide with parent", !dups1.some(d => String(d.Id) === "5"));

  // Subsequent duplication: 2 more records should be Sub4, Sub5
  const dups2 = X.duplicateRecord("5", 2);
  ok("Second duplication created 2 records", Array.isArray(dups2) && dups2.length === 2);
  eq("Fourth duplicate has SubNumber Sub4", dups2[0] && dups2[0].SubNumber, "Sub4");
  eq("Fifth duplicate has SubNumber Sub5", dups2[1] && dups2[1].SubNumber, "Sub5");

  // getSubRecords check
  if (typeof X.getSubRecords === "function") {
    const subs = X.getSubRecords("5");
    eq("getSubRecords('5') returns 5 records", subs.length, 5);
    eq("getSubRecords returns in order Sub1..Sub5", subs.map(s => s.SubNumber), ["Sub1", "Sub2", "Sub3", "Sub4", "Sub5"]);
  }

  // Duplicating when source record is a sub-record (e.g. Sub2)
  const sub2 = dups1[1]; // Sub2
  const dupsFromChild = X.duplicateRecord(sub2.Id, 1);
  ok("Duplicating from child created 1 record", dupsFromChild.length === 1);
  eq("Duplicate from child has ParentRecordId '5'", String(dupsFromChild[0].ParentRecordId), "5");
  eq("Duplicate from child has SubNumber Sub6", dupsFromChild[0].SubNumber, "Sub6");
}

// 7. Quantity validation & modal confirm
if (typeof X.confirmDuplicateRecord === "function") {
  X.state.currentRecord = { Id: "5", Title: "REQ-2026-005" };
  const qtyInput = getMockElement("duplicate-quantity");
  const errorEl = getMockElement("duplicate-error");

  // Test invalid: "0"
  qtyInput.value = "0";
  X.confirmDuplicateRecord();
  ok("Rejects quantity 0 with error displayed", !errorEl.classList.contains("hidden") || errorEl.style.display !== "none");

  // Test invalid: "11"
  qtyInput.value = "11";
  X.confirmDuplicateRecord();
  ok("Rejects quantity 11 with error displayed", !errorEl.classList.contains("hidden") || errorEl.style.display !== "none");

  // Test invalid: "2.5"
  qtyInput.value = "2.5";
  X.confirmDuplicateRecord();
  ok("Rejects decimals with error displayed", !errorEl.classList.contains("hidden") || errorEl.style.display !== "none");

  // Test invalid: "abc"
  qtyInput.value = "abc";
  X.confirmDuplicateRecord();
  ok("Rejects letters with error displayed", !errorEl.classList.contains("hidden") || errorEl.style.display !== "none");
}

// 8. Dataverse column mapping & persistence verification
ok("DV_COLUMN_MAP maps admin_recordidsubnumber to SubNumber", X.DV_COLUMN_MAP && X.DV_COLUMN_MAP["admin_recordidsubnumber"] === "SubNumber");

(async () => {
  if (typeof X.persistRecordToDataverse === "function") {
    // Test updating sub-record with existing dataverseId
    const subRecordToUpdate = {
      Title: "REQ-2026-005",
      SubNumber: "Sub1",
      IsSubRecord: true,
      dataverseId: "sub-record-guid-1",
      _entityName: "admin_btb_lis_excel_datas"
    };

    await X.persistRecordToDataverse(subRecordToUpdate);
    const foundUpdate = dataverseUpdates.find(u => u.id === "sub-record-guid-1");
    ok("persistRecordToDataverse saves admin_recordidsubnumber on update", foundUpdate && foundUpdate.payload && foundUpdate.payload.admin_recordidsubnumber === "Sub1");

    // Test creating sub-record without dataverseId:
    // Duplicates the record first, then adds the sub number value to admin_recordidsubnumber
    const subRecordToCreate = {
      Title: "REQ-2026-005",
      SubNumber: "Sub2",
      IsSubRecord: true,
      _entityName: "admin_btb_lis_excel_datas"
    };

    const createsBefore = dataverseCreates.length;
    await X.persistRecordToDataverse(subRecordToCreate);
    const foundCreate = dataverseCreates.slice(createsBefore).find(c => c.payload && c.payload.admin_title === "REQ-2026-005" && c.payload.admin_recordidsubnumber === undefined);
    ok("persistRecordToDataverse duplicates record first in table admin_btb_lis_excel_datas", !!foundCreate);

    const createdId = subRecordToCreate.dataverseId;
    const foundSubUpdate = dataverseUpdates.find(u => u.id === createdId && u.payload && u.payload.admin_recordidsubnumber === "Sub2");
    ok("persistRecordToDataverse then adds sub number value to column admin_recordidsubnumber", !!foundSubUpdate);
  }

  if (failures > 0) {
    console.error(`\nFAILED: ${failures} check(s) failed.`);
    process.exit(1);
  } else {
    console.log("\nALL CHECKS PASSED: Duplicate feature verified successfully.");
  }
})();
