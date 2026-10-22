/* master-page-urgent-case.test.js -- Verification for Urgent Case toggle relocation and UM Verification card border
   --------------------------------------------------------------------------------------------------------------------
   Verifies:
   1. "Urgent Case" toggle is removed from the sticky navigation bar above the tab content.
   2. "Urgent Case" toggle is placed at the top-right of the "UM Verification" card (#umVerificationCard).
   3. #umVerificationCard has CSS definition for .is-urgent with thick red border.
   4. Toggling Urgent Case updates #umVerificationCard border dynamically:
      - When Urgent Case is ON: card has .is-urgent and thick red border.
      - When Urgent Case is OFF: card reverts to default border.
   5. FIELD_ID_TO_RECORD_KEY and CHECKBOX_FIELD_IDS still map edit-urgent-flag to UrgentFlag.
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

// 1. Static HTML Checks

// Check sticky nav bar does not contain edit-urgent-flag
const stickyNavMatch = HTML.match(/<!-- Sticky Navigation Bar[\s\S]*?id="modalTabButtons"[\s\S]*?<\/div>\s*<\/div>\s*<\/div>\s*<\/div>/);
ok("Sticky Navigation Bar exists", Boolean(stickyNavMatch));
if (stickyNavMatch) {
  ok("Sticky Navigation Bar does NOT contain edit-urgent-flag", !stickyNavMatch[0].includes("edit-urgent-flag"));
  ok("Sticky Navigation Bar does NOT contain 'Urgent Case'", !stickyNavMatch[0].includes("Urgent Case"));
}

// Check umVerificationCard exists
ok("umVerificationCard exists in HTML", HTML.includes('id="umVerificationCard"'));

// Find umVerificationCard block in HTML
const umCardMatch = HTML.match(/<div[^>]*id="umVerificationCard"[^>]*>([\s\S]*?)<\/div>\s*<\/div>\s*<div[^>]*id="prApprovalSection"/);
ok("Found umVerificationCard content in HTML", Boolean(umCardMatch));
const umCardHtml = umCardMatch ? umCardMatch[1] : "";

// Check Urgent Case toggle is inside umVerificationCard
ok("edit-urgent-flag is inside umVerificationCard", umCardHtml.includes('id="edit-urgent-flag"'));
ok("Urgent Case label is inside umVerificationCard", umCardHtml.includes("Urgent Case"));
ok("edit-urgent-flag has onchange handler handleUrgentFlagChange()", umCardHtml.includes('onchange="handleUrgentFlagChange()"'));

// Check relative placement: "UM Verification" and "Urgent Case" are in the header row
const umTitlePos = umCardHtml.indexOf("UM Verification");
const urgentTogglePos = umCardHtml.indexOf("Urgent Case");
const warningTextPos = umCardHtml.indexOf("Before sending the approval request");
ok("UM Verification title appears in card", umTitlePos !== -1);
ok("Urgent Case toggle appears in card", urgentTogglePos !== -1);
ok("Both title and Urgent Case toggle appear before warning notice", umTitlePos < warningTextPos && urgentTogglePos < warningTextPos);

// Check CSS styling
ok("CSS defines #umVerificationCard.is-urgent with red border", HTML.includes("#umVerificationCard.is-urgent"));
ok("CSS uses var(--red) for border color", /#umVerificationCard\.is-urgent\s*\{[^}]*var\(--red\)/.test(HTML));

// 2. JavaScript Execution & Dynamic Behavior Checks

const scriptMatch = HTML.match(/<script>([\s\S]*?)<\/script>[\s\S]*?<\/body>/);
if (!scriptMatch) {
  console.error("FAIL: could not extract script block from " + HTML_PATH);
  process.exit(1);
}

// Build mock DOM elements
const elements = new Map();
function makeElement(tag, id, classes = "") {
  const classList = new Set(classes ? classes.split(/\s+/).filter(Boolean) : []);
  const el = {
    tagName: tag.toUpperCase(),
    id: id || "",
    value: "",
    checked: false,
    innerText: "",
    textContent: "",
    innerHTML: "",
    style: {},
    classList: {
      add: (...cls) => cls.forEach(c => classList.add(c)),
      remove: (...cls) => cls.forEach(c => classList.delete(c)),
      contains: (c) => classList.has(c),
      toggle: (c) => classList.has(c) ? classList.delete(c) : classList.add(c)
    },
    getAttribute: (attr) => null,
    setAttribute: (attr, val) => {},
    removeAttribute: (attr) => {},
    closest: () => null,
    focus: () => {},
    scrollIntoView: () => {},
    querySelector: () => null,
    querySelectorAll: () => []
  };
  if (id) elements.set(id, el);
  return el;
}

const mockDoc = {
  getElementById: (id) => elements.get(id) || null,
  querySelector: () => null,
  querySelectorAll: () => [],
  createElement: (tag) => makeElement(tag, ""),
  addEventListener: () => {},
  body: makeElement("body", "body")
};

// Populate required elements
makeElement("div", "modalFormContainer");
makeElement("div", "editModalTabContent");
makeElement("input", "edit-urgent-flag");
makeElement("div", "umVerificationCard", "border border-[#E5E5EA] rounded-xl p-4 bg-[#F9F9FB]");
makeElement("input", "edit-prno");
makeElement("input", "edit-pono");
makeElement("input", "edit-processstatus");
makeElement("div", "statusTracker");
makeElement("div", "um-review-info");
makeElement("button", "btn-send-approval");
makeElement("div", "prApprovalSection");
makeElement("input", "edit-pr-approved");
makeElement("div", "editModal");

const sandbox = {
  document: mockDoc,
  window: { addEventListener: () => {} },
  navigator: {},
  location: { search: "" },
  URLSearchParams: function(init) {
    const params = new Map();
    return {
      get: (k) => params.get(k),
      set: (k, v) => params.set(k, v),
      delete: (k) => params.delete(k),
      toString: () => ""
    };
  },
  console: { log: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
  setTimeout: (fn) => setTimeout(fn, 0),
  showToast: () => {},
  evaluateWorkflowState: (rec) => rec.ProcessStatus || "PR No. Ready",
  updateRequiredFieldIndicators: () => {},
  updateFieldLockingAndApprovalUI: () => {},
  updatePRApprovalRolesUI: () => {}
};

const scriptCode = scriptMatch[1] + `
;this.EXPORTS = {
  FIELD_ID_TO_RECORD_KEY,
  CHECKBOX_FIELD_IDS,
  updateUrgentCaseUI: typeof updateUrgentCaseUI !== 'undefined' ? updateUrgentCaseUI : undefined,
  handleUrgentFlagChange: typeof handleUrgentFlagChange !== 'undefined' ? handleUrgentFlagChange : undefined,
  getState: () => state
};
`;

const ctx = vm.createContext(sandbox);
vm.runInContext(scriptCode, ctx);

const modExports = ctx.EXPORTS;
ok("FIELD_ID_TO_RECORD_KEY maps edit-urgent-flag to UrgentFlag", modExports.FIELD_ID_TO_RECORD_KEY['edit-urgent-flag'] === 'UrgentFlag');
ok("CHECKBOX_FIELD_IDS includes edit-urgent-flag", modExports.CHECKBOX_FIELD_IDS.has('edit-urgent-flag'));
ok("updateUrgentCaseUI is defined", typeof modExports.updateUrgentCaseUI === 'function');
ok("handleUrgentFlagChange is defined", typeof modExports.handleUrgentFlagChange === 'function');

const cardEl = elements.get("umVerificationCard");
const flagEl = elements.get("edit-urgent-flag");

// Test 1: Initially unchecked
flagEl.checked = false;
modExports.updateUrgentCaseUI();
ok("When unchecked: card does not have is-urgent class", !cardEl.classList.contains("is-urgent"));
ok("When unchecked: card border style is reset", cardEl.style.borderColor === "");

// Test 2: Toggle ON
flagEl.checked = true;
modExports.updateUrgentCaseUI();
ok("When checked: card has is-urgent class", cardEl.classList.contains("is-urgent"));
ok("When checked: card border color is var(--red)", cardEl.style.borderColor === "var(--red)");
ok("When checked: card border width is 2.5px", cardEl.style.borderWidth === "2.5px");
ok("When checked: card has border-red-600 class", cardEl.classList.contains("border-red-600"));

// Test 3: Toggle OFF
flagEl.checked = false;
modExports.updateUrgentCaseUI();
ok("When toggled off: is-urgent class is removed", !cardEl.classList.contains("is-urgent"));
ok("When toggled off: card border color is cleared", cardEl.style.borderColor === "");
ok("When toggled off: card border width is cleared", cardEl.style.borderWidth === "");
ok("When toggled off: card restored default border class", cardEl.classList.contains("border-[#E5E5EA]"));

// Test 4: handleUrgentFlagChange updates state.currentRecord
const state = modExports.getState();
state.currentRecord = { Id: "1", UrgentFlag: false, ProcessStatus: "PR No. Ready" };
flagEl.checked = true;
modExports.handleUrgentFlagChange();
ok("handleUrgentFlagChange updates state.currentRecord.UrgentFlag", state.currentRecord.UrgentFlag === true);
ok("handleUrgentFlagChange applies is-urgent class to card", cardEl.classList.contains("is-urgent"));

if (failures > 0) {
  console.error(`\n${failures} check(s) FAILED`);
  process.exit(1);
} else {
  console.log("\nALL CHECKS PASSED: Urgent Case relocation and dynamic border verified successfully.");
}
