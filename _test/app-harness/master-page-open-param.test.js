/* master-page-open-param.test.js -- Verification for URL Param and Modal Auto-Open
   -----------------------------------------------------------------------------------------
   Verifies:
   1. openEditModal(null / undefined / "") does NOT open the edit modal,
      even when allData contains records with Title: null, Id: null, or undefined.
   2. openParamItem() does NOT call openEditModal or show the modal when location.search
      is empty or does not contain a valid 'record' parameter.
   3. openParamItem() DOES open the modal when location.search contains a valid '?record=<id>'.
   4. pushQueryStr() cleanly cleans up the search query string without trailing '?'.
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
      innerText: "",
      value: "",
      classList: {
        classes: new Set(["hidden"]),
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
      closest: () => null
    });
  }
  return domElements.get(id);
}

const pushedUrls = [];
let mockSearch = "";

const sandbox = {
  console,
  setTimeout, clearTimeout,
  TextEncoder, Uint8Array,
  window: {
    addEventListener() {},
    localStorage: { getItem: () => null, setItem: () => {} },
    history: {
      pushState: (state, title, url) => { pushedUrls.push(url); }
    },
    location: {
      get search() { return mockSearch; },
      set search(v) { mockSearch = v; },
      get href() { return "http://localhost/Master%20page_21-Sep-2026.html" + mockSearch; }
    }
  },
  document: {
    addEventListener() {},
    getElementById: (id) => getMockElement(id),
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => ({ setAttribute() {}, appendChild() {}, remove: () => {}, click() {}, style: {} }),
    body: { classList: { add() {}, remove() {} }, style: {} },
  },
  get location() {
    return sandbox.window.location;
  },
  get history() {
    return sandbox.window.history;
  },
  URLSearchParams: class extends URLSearchParams {
    constructor(init) {
      super(init !== undefined ? init : mockSearch);
    }
  },
  URL: class extends URL {
    constructor(url, base) {
      super(url, base || "http://localhost/Master%20page_21-Sep-2026.html");
    }
  },
  parent: { Xrm: { WebApi: null } },
  Date,
  Math,
  String,
  Number,
  Boolean,
  RegExp,
  Array,
  Object,
  Set,
  Map,
  parseFloat,
  parseInt,
  isNaN,
  encodeURIComponent
};

const context = vm.createContext(sandbox);

let scriptBody = scriptMatch[1] + `
;EXPORTS = {
  state,
  openEditModal,
  openParamItem,
  closeModal,
  pushQueryStr,
  initMockApp
};`;

try {
  vm.runInContext(scriptBody, context);
  ok("Master page script evaluated cleanly", true);
} catch (e) {
  console.error("Master page script execution failed:", e);
  process.exit(1);
}

const X = sandbox.EXPORTS;
const editModalEl = getMockElement("editModal");

// Set up allData with some records, including records with Title: null or empty
X.state.allData = [
  { Id: "REC-1", Title: "REQ-2026-001", CustomerName: "Acme", ProcessStatus: "PR No. Ready" },
  { Id: "REC-NULL", Title: null, CustomerName: "Incomplete", ProcessStatus: "PR No. Ready" },
  { Id: "REC-2", Title: "REQ-2026-002", CustomerName: "Beta", ProcessStatus: "PO No. Ready" }
];

// Test 1: openEditModal(null) should NOT open editModal
editModalEl.classList.add("hidden");
editModalEl.classList.remove("flex");
X.openEditModal(null);
ok("openEditModal(null) does NOT open editModal", editModalEl.classList.contains("hidden") && !editModalEl.classList.contains("flex"));

// Test 2: openEditModal("") should NOT open editModal
editModalEl.classList.add("hidden");
editModalEl.classList.remove("flex");
X.openEditModal("");
ok("openEditModal('') does NOT open editModal", editModalEl.classList.contains("hidden") && !editModalEl.classList.contains("flex"));

// Test 3: openParamItem() with empty location.search should NOT open editModal
mockSearch = "";
editModalEl.classList.add("hidden");
editModalEl.classList.remove("flex");
X.openParamItem();
ok("openParamItem() with empty search does NOT open editModal", editModalEl.classList.contains("hidden") && !editModalEl.classList.contains("flex"));

// Test 4: openParamItem() with unrelated search param should NOT open editModal
mockSearch = "?other=123";
editModalEl.classList.add("hidden");
editModalEl.classList.remove("flex");
X.openParamItem();
ok("openParamItem() with unrelated param does NOT open editModal", editModalEl.classList.contains("hidden") && !editModalEl.classList.contains("flex"));

// Test 5: openParamItem() with ?record=REC-1 DOES open editModal
mockSearch = "?record=REC-1";
editModalEl.classList.add("hidden");
editModalEl.classList.remove("flex");
X.openParamItem();
ok("openParamItem() with ?record=REC-1 unhides editModal", !editModalEl.classList.contains("hidden") && editModalEl.classList.contains("flex"));
eq("openParamItem() loaded correct currentRecord", X.state.currentRecord && X.state.currentRecord.Id, "REC-1");

// Test 6: closeModal() clears ?record without leaving a dangling '?'
pushedUrls.length = 0;
X.closeModal();
const lastUrl = pushedUrls[pushedUrls.length - 1];
ok("closeModal pushed clean URL without dangling '?'", !lastUrl.endsWith("?"));

// Test 7: openEditModal with admin_recordidno value loads correct currentRecord
X.state.allData.push({
  Id: "guid-rec-99",
  Title: "REQ-2026-099",
  admin_recordidno: "RECID-9999",
  RecordIdNo: "RECID-9999",
  CustomerName: "Gamma Corp",
  ProcessStatus: "UM Verified"
});
editModalEl.classList.add("hidden");
editModalEl.classList.remove("flex");
X.openEditModal("RECID-9999");
ok("openEditModal('RECID-9999') unhides editModal", !editModalEl.classList.contains("hidden") && editModalEl.classList.contains("flex"));
eq("openEditModal with admin_recordidno loaded correct currentRecord", X.state.currentRecord && X.state.currentRecord.admin_recordidno, "RECID-9999");
eq("currentRecord.Id matches expected dataverseId/Id", X.state.currentRecord && X.state.currentRecord.Id, "guid-rec-99");
const latestPushedUrl = pushedUrls[pushedUrls.length - 1];
ok("openEditModal pushed URL with admin_recordidno as record param", latestPushedUrl && latestPushedUrl.includes("record=RECID-9999"));
X.closeModal();

// Test 8: openParamItem() with ?record=<admin_recordidno> loads correct currentRecord
mockSearch = "?record=RECID-9999";
editModalEl.classList.add("hidden");
editModalEl.classList.remove("flex");
X.openParamItem();
ok("openParamItem() with ?record=RECID-9999 unhides editModal", !editModalEl.classList.contains("hidden") && editModalEl.classList.contains("flex"));
eq("openParamItem() with ?record=RECID-9999 loaded correct currentRecord", X.state.currentRecord && X.state.currentRecord.admin_recordidno, "RECID-9999");
X.closeModal();

if (failures > 0) {
  console.error(`\nFAILED: ${failures} check(s) failed.`);
  process.exit(1);
} else {
  console.log("\nALL CHECKS PASSED: openParamItem and openEditModal verified successfully.");
}
