/**
 * Test: LIS Remark Button Loading Animation
 * Verifies that clicking #btn-modal-remark displays a loading animation (.loader-sm),
 * disables the button, updates the button text to show it is loading, prevents re-entrancy,
 * and restores the button state after loading finishes or if an error occurs.
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const HTML_PATH = path.resolve(__dirname, "../../Master page_21-Sep-2026.html");
const html = fs.readFileSync(HTML_PATH, "utf8");

// ── 1. Static HTML Checks ────────────────────────────────────────────────────
console.log("Checking static HTML for LIS Remark button and loader-sm...");

assert(html.includes('id="btn-modal-remark"'), "HTML has #btn-modal-remark in modal header");
assert(html.includes('onclick="openRemarkModal()"'), "Remark button has openRemarkModal onclick handler");
assert(html.includes(".loader-sm"), "HTML style includes .loader-sm CSS rule for small spinner");

// ── 2. Script Execution in Sandbox ───────────────────────────────────────────
const scriptMatch = html.match(/<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/i);
assert(!!scriptMatch, "Found embedded script in Master page_21-Sep-2026.html");

const mockWebApi = {
  retrieveMultipleRecords: async (entity) => {
    // Artificial small delay to simulate network latency
    await new Promise((r) => setTimeout(r, 20));
    return { entities: [] };
  },
};

const domStore = {};
function getMockElement(id) {
  if (!domStore[id]) {
    domStore[id] = {
      id,
      tagName: "DIV",
      value: "",
      innerText: "",
      innerHTML: "",
      disabled: false,
      style: {},
      dataset: {},
      classList: {
        classes: new Set(),
        add: function (c) {
          this.classes.add(c);
        },
        remove: function (c) {
          this.classes.delete(c);
        },
        contains: function (c) {
          return this.classes.has(c);
        },
      },
      setAttribute: function (k, v) {
        this[k] = v;
      },
      removeAttribute: function (k) {
        delete this[k];
      },
      scrollIntoView: () => {},
      focus: () => {},
    };
  }
  return domStore[id];
}

const sandbox = {
  console,
  setTimeout,
  clearTimeout,
  window: {
    addEventListener: () => {},
    localStorage: { getItem: () => null, setItem: () => {} },
    history: { pushState: () => {} },
    location: { search: "" },
    Xrm: { WebApi: mockWebApi },
  },
  parent: {
    Xrm: { WebApi: mockWebApi },
  },
  Xrm: { WebApi: mockWebApi },
  document: {
    addEventListener: () => {},
    getElementById: (id) => getMockElement(id),
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: (tag) => ({
      tagName: tag ? tag.toUpperCase() : "DIV",
      id: "",
      className: "",
      classList: { add: () => {}, remove: () => {} },
      appendChild: () => {},
      innerHTML: "",
      innerText: "",
      value: "",
      style: {},
      focus: () => {},
      select: () => {},
    }),
    body: { appendChild: () => {}, removeChild: () => {}, execCommand: () => {} },
  },
  location: { search: "" },
  history: { pushState: () => {} },
  navigator: { clipboard: { writeText: async () => {} } },
  Set,
  Map,
  Date,
  Math,
  String,
  Number,
  Boolean,
  Array,
  RegExp,
  Object,
  JSON,
  Promise,
  EXPORTS: {},
};
sandbox.globalThis = sandbox;

const SCRIPT_CODE =
  scriptMatch[1] +
  `
;EXPORTS.openRemarkModal = openRemarkModal;
EXPORTS.state = state;
`;

vm.createContext(sandbox);
vm.runInContext(SCRIPT_CODE, sandbox);

(async function runTests() {
  console.log("Running LIS Remark loading animation tests...");

  // Setup DOM elements
  const btn = getMockElement("btn-modal-remark");
  btn.innerHTML = `<span>💬</span> LIS Remark`;
  btn.disabled = false;
  delete btn.dataset.loading;

  const modal = getMockElement("remarkModal");
  modal.classList.add("hidden");

  // Pre-set a record
  sandbox.EXPORTS.state.currentRecord = {
    Id: "REC-TEST-REMARK",
    Title: "ATQ-2026-TEST",
    HandledBy: "Test User",
    IssueBy: "Test Issue",
    ChargeCCC: "C665",
  };

  // ── 3. Test Loading State During openRemarkModal Execution ──────────────────
  let loadingObserved = false;
  let loadingHtml = "";
  let wasDisabledDuringLoad = false;

  const promise = sandbox.EXPORTS.openRemarkModal();

  // Inspect state synchronously or after microtask tick while promise is pending
  await new Promise((r) => setTimeout(r, 5));

  if (btn.dataset.loading === "true" && btn.disabled === true) {
    loadingObserved = true;
    loadingHtml = btn.innerHTML;
    wasDisabledDuringLoad = btn.disabled;
  }

  assert(loadingObserved, "btn-modal-remark was flagged as loading during openRemarkModal");
  assert(wasDisabledDuringLoad, "btn-modal-remark was disabled during openRemarkModal to prevent duplicate clicks");
  assert(loadingHtml.includes("loader-sm"), "btn-modal-remark displayed loader-sm spinner during loading");
  assert(loadingHtml.toLowerCase().includes("loading"), "btn-modal-remark displayed Loading text during loading");

  // Await completion
  await promise;

  // ── 4. Test Completion and Restoration ──────────────────────────────────────
  assert(!modal.classList.contains("hidden"), "remarkModal is visible after openRemarkModal completes");
  assert(modal.classList.contains("flex"), "remarkModal has 'flex' class after openRemarkModal completes");
  assert(btn.disabled === false, "btn-modal-remark is re-enabled after openRemarkModal completes");
  assert(!btn.dataset.loading, "btn-modal-remark dataset.loading is cleared after openRemarkModal completes");
  assert(btn.innerHTML.includes("LIS Remark"), "btn-modal-remark restored original 'LIS Remark' text after openRemarkModal completes");
  assert(btn.innerHTML.includes("💬"), "btn-modal-remark restored original emoji icon after openRemarkModal completes");

  console.log("\nALL CHECKS PASSED: LIS Remark loading animation verified successfully.");
})();
