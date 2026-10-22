/* master-page-version.test.js -- Verification for Master Page Version Logic
   -----------------------------------------------------------------------------------------
   Verifies:
   1. Static markup:
      - #app-version-badge exists in HTML header beside the title
      - #app-version-badge contains initial V prefix and semver string
   2. Script execution & exports:
      - APP_VERSION is defined as a semver string (MAJOR.MINOR.PATCH)
      - window.APP_VERSION is exposed
      - renderVersionUI() function is defined and updates #app-version-badge
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
ok("Version badge #app-version-badge exists in HTML", HTML.includes('id="app-version-badge"'));
const badgeMatch = HTML.match(/id="app-version-badge"[^>]*>([\s\S]*?)<\/span>/);
ok("Version badge has content", !!badgeMatch && !!badgeMatch[1].trim());
if (badgeMatch) {
  const badgeText = badgeMatch[1].trim();
  ok("Version badge starts with capital V", badgeText.startsWith("V"));
  const verPart = badgeText.slice(1);
  ok("Version badge content has valid semver format", /^\d+\.\d+\.\d+$/.test(verPart), { badgeText });
}

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

const storageStore = new Map();
const mockLocalStorage = {
  getItem: (k) => (storageStore.has(k) ? storageStore.get(k) : null),
  setItem: (k, v) => storageStore.set(k, String(v)),
  removeItem: (k) => storageStore.delete(k),
  clear: () => storageStore.clear()
};

const sandbox = {
  console,
  setTimeout, clearTimeout,
  TextEncoder, Uint8Array,
  localStorage: mockLocalStorage,
  window: {
    addEventListener() {},
    localStorage: mockLocalStorage,
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
  parent: { Xrm: { WebApi: {} } },
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
;EXPORTS.APP_VERSION = typeof APP_VERSION !== 'undefined' ? APP_VERSION : undefined;
EXPORTS.renderVersionUI = typeof renderVersionUI !== 'undefined' ? renderVersionUI : undefined;
`;

try {
  vm.runInNewContext(SCRIPT_CODE, sandbox);
  console.log("OK   Script evaluated cleanly");
} catch (e) {
  console.error("FAIL Script evaluation threw: " + e.message);
  process.exit(1);
}

const X = sandbox.EXPORTS;

// 3. Constant and function checks
ok("APP_VERSION is defined", typeof X.APP_VERSION === "string");
ok("APP_VERSION is a valid semver string (MAJOR.MINOR.PATCH)", /^\d+\.\d+\.\d+$/.test(X.APP_VERSION), { APP_VERSION: X.APP_VERSION });
ok("window.APP_VERSION is exposed", sandbox.window.APP_VERSION === X.APP_VERSION);
ok("renderVersionUI function is defined", typeof X.renderVersionUI === "function");

// 4. renderVersionUI behavior check
if (typeof X.renderVersionUI === "function") {
  const badgeEl = getMockElement("app-version-badge");
  badgeEl.textContent = "";
  X.renderVersionUI();
  eq("renderVersionUI sets #app-version-badge textContent to V<APP_VERSION>", badgeEl.textContent, "V" + X.APP_VERSION);
}

if (failures > 0) {
  console.error(`\nFAILED: ${failures} check(s) failed.`);
  process.exit(1);
} else {
  console.log("\nALL CHECKS PASSED: Master page version logic verified successfully.");
}
