/* master-page-digital-clock.test.js -- Verification for Master Page Digital Clock
   -----------------------------------------------------------------------------------------
   Verifies:
   1. Static markup:
      - #digital-clock container exists in HTML header
      - #digital-clock-date exists for displaying the date
      - #digital-clock-time exists for displaying the time
   2. Script execution & exports:
      - updateDigitalClock is defined as a function
      - window.updateDigitalClock is exposed
      - initDigitalClock is defined as a function
      - window.initDigitalClock is exposed
      - updateDigitalClock formats date and time correctly given a test Date
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
ok("Digital clock container #digital-clock exists in HTML", HTML.includes('id="digital-clock"'));
ok("Digital clock date element #digital-clock-date exists in HTML", HTML.includes('id="digital-clock-date"'));
ok("Digital clock time element #digital-clock-time exists in HTML", HTML.includes('id="digital-clock-time"'));

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

const sandbox = {
  console,
  setTimeout: () => {},
  clearTimeout: () => {},
  setInterval: (fn, ms) => {},
  clearInterval: () => {},
  Date,
  Math,
  String,
  Number,
  Array,
  Object,
  RegExp,
  document: {
    getElementById: (id) => getMockElement(id),
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: () => {},
    createElement: (tag) => getMockElement("mock-" + tag),
    body: {
      classList: { add() {}, remove() {}, contains: () => false },
      appendChild() {}
    }
  },
  window: {}
};
sandbox.window = sandbox;

try {
  vm.createContext(sandbox);
  vm.runInContext(scriptMatch[1], sandbox);
  console.log("OK   Script evaluated cleanly");
} catch (err) {
  console.error("FAIL Script evaluation threw an error:", err);
  process.exit(1);
}

ok("updateDigitalClock is defined", typeof sandbox.updateDigitalClock === "function");
ok("window.updateDigitalClock is exposed", typeof sandbox.window.updateDigitalClock === "function");
ok("initDigitalClock is defined", typeof sandbox.initDigitalClock === "function");
ok("window.initDigitalClock is exposed", typeof sandbox.window.initDigitalClock === "function");

// Test formatting with a known date
// Wednesday, 21 October 2026, 14:05:09
const testDate = new Date(2026, 9, 21, 14, 5, 9); // Month is 0-indexed: 9 = October
sandbox.updateDigitalClock(testDate);

const dateEl = getMockElement("digital-clock-date");
const timeEl = getMockElement("digital-clock-time");

eq("Date element formatted correctly", dateEl.textContent, "21 Oct 2026 (Wed)");
eq("Time element formatted correctly", timeEl.textContent, "14:05:09");

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
} else {
  console.log("\nALL CHECKS PASSED: Digital clock logic and markup verified successfully.");
}
