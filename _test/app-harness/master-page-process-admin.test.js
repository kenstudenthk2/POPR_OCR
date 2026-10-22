/* master-page-process-admin.test.js -- Verification for Process Admin Dropdown in Master page_21-Sep-2026.html
   Tests:
   1. HTML markup has header-process-admin, btn-edit-process-admin, and Process Admin Selector card
   2. PROCESS_ADMIN_STORAGE_KEY is 'processadmin'
   3. getSavedProcessAdmin and saveProcessAdmin interact correctly with localStorage
   4. When localStorage has saved admin:
      - initProcessAdmin sets dropdown to saved admin
      - dropdown is disabled (locked)
      - Edit Logo button is displayed
      - initApp loads master records
   5. When localStorage has NO admin:
      - initProcessAdmin leaves dropdown enabled (free to select)
      - Edit button is hidden
      - initApp does not load master records; calls renderEmptyAdminState
      - tableBody displays admin name required prompt
   6. Selecting admin in dropdown:
      - saves to localStorage under 'processadmin'
      - locks dropdown
      - shows Edit button
      - loads master records
   7. Clicking Edit button:
      - unlocks dropdown to allow selecting another admin
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
assert(html.includes('id="header-process-admin"'), "HTML includes header-process-admin dropdown");
assert(html.includes('id="btn-edit-process-admin"'), "HTML includes btn-edit-process-admin Edit button");
assert(html.includes("Select Admin to Process Record"), "HTML includes 'Select Admin to Process Record' label");
assert(html.includes("Choose your admin name before loading master records"), "HTML includes description prompt");
assert(html.includes('onchange="handleProcessAdminChange(this.value)"'), "dropdown wires handleProcessAdminChange");
assert(html.includes('onclick="handleEditProcessAdmin()"'), "Edit button wires handleEditProcessAdmin");

// ── 2. Script Execution in Sandbox ───────────────────────────────────────────
const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>[\s\S]*?<\/body>/);
assert(!!scriptMatch, "Found embedded script in Master page_21-Sep-2026.html");

const mockLocalStorage = {};

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
    };
  }
  return elements[id];
}

let loadDataCallCount = 0;
let processDataCallCount = 0;

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
  console,
  setTimeout(fn) { if (typeof fn === "function") fn(); },
  clearTimeout() {},
  setInterval() {},
  clearInterval() {},
  URL,
  URLSearchParams,
  XLSX: { utils: { book_new: () => ({}), book_append_sheet: () => {} }, writeFile: () => {} },
  loadData: async () => { loadDataCallCount++; },
  processData: () => { processDataCallCount++; },
  showLoader: () => {},
  showToast: () => {},
  openParamItem: () => {},
};

sandbox.globalThis = sandbox;
sandbox.window.window = sandbox.window;
sandbox.localStorage = sandbox.window.localStorage;
sandbox.location = sandbox.window.location;

vm.createContext(sandbox);
vm.runInContext(scriptMatch[1], sandbox);

(async () => {
  // ── 3. Storage Key & Helpers ────────────────────────────────────────────────
  assert(sandbox.PROCESS_ADMIN_STORAGE_KEY === "processadmin", "PROCESS_ADMIN_STORAGE_KEY is 'processadmin'");
  assert(typeof sandbox.getSavedProcessAdmin === "function", "getSavedProcessAdmin is a function");
  assert(typeof sandbox.saveProcessAdmin === "function", "saveProcessAdmin is a function");

  // ── 4. When localStorage has NO admin ────────────────────────────────────────
  delete mockLocalStorage["processadmin"];
  assert(sandbox.getSavedProcessAdmin() === "", "getSavedProcessAdmin returns empty string when storage empty");

  // Reset element state
  const adminSelect = getMockElement("header-process-admin");
  const editBtn = getMockElement("btn-edit-process-admin");
  const tableBody = getMockElement("tableBody");
  adminSelect.value = "";
  adminSelect.disabled = false;
  editBtn.classList.classes = new Set(["hidden"]);

  loadDataCallCount = 0;
  await sandbox.initProcessAdmin();

  assert(adminSelect.disabled === false, "Dropdown is NOT disabled when process admin has no value");
  assert(editBtn.classList.contains("hidden"), "Edit button is hidden when process admin has no value");
  assert(loadDataCallCount === 0, "Master list is NOT loaded when process admin has no value");
  assert(tableBody.innerHTML.includes("Process Admin Name Required"), "tableBody shows 'Process Admin Name Required' prompt");

  // ── 5. Selecting an admin in the dropdown ─────────────────────────────────────
  let initAppCalled = false;
  const originalInitApp = sandbox.initApp;
  sandbox.initApp = async () => {
    initAppCalled = true;
    return originalInitApp();
  };

  sandbox.handleProcessAdminChange("Lee, Mandy MY");

  assert(mockLocalStorage["processadmin"] === "Lee, Mandy MY", "Saves selected admin to localStorage under 'processadmin'");
  assert(sandbox.getSavedProcessAdmin() === "Lee, Mandy MY", "getSavedProcessAdmin reads newly saved admin");
  assert(adminSelect.disabled === true, "Dropdown is locked (disabled=true) after admin selection");
  assert(!editBtn.classList.contains("hidden"), "Edit button is displayed after admin selection");
  assert(initAppCalled === true, "Master list initApp was called after admin selection");

  // ── 6. Clicking the Edit button to unlock ─────────────────────────────────────
  assert(sandbox.isProcessAdminEditing === false, "isProcessAdminEditing is initially false");
  sandbox.handleEditProcessAdmin();

  assert(sandbox.isProcessAdminEditing === true, "isProcessAdminEditing toggles to true on click");
  assert(adminSelect.disabled === false, "Dropdown is unlocked (disabled=false) for editing");
  assert(adminSelect.focused === true, "Dropdown received focus when unlocked");

  // Re-lock without changing
  sandbox.handleEditProcessAdmin();
  assert(sandbox.isProcessAdminEditing === false, "isProcessAdminEditing toggles back to false");
  assert(adminSelect.disabled === true, "Dropdown is re-locked (disabled=true)");

  // ── 7. Initializing on next visit with saved admin ───────────────────────────
  mockLocalStorage["processadmin"] = "Chow, Alice SW";
  initAppCalled = false;
  adminSelect.disabled = false;
  editBtn.classList.classes = new Set(["hidden"]);

  await sandbox.initProcessAdmin();

  assert(adminSelect.value === "Chow, Alice SW", "Dropdown pre-selects saved admin from localStorage");
  assert(adminSelect.disabled === true, "Dropdown is locked (disabled=true) on load when saved value exists");
  assert(!editBtn.classList.contains("hidden"), "Edit button is visible on load when saved value exists");
  assert(initAppCalled === true, "Master list initApp was automatically called when saved value exists");

  console.log("\nALL PROCESS ADMIN TESTS IN MASTER PAGE PASSED!");
})();
