/* master-page-disabled-fields.test.js
   -----------------------------------------------------------------------------------------
   Verifies that Master page_21-Sep-2026.html has the requested fields disabled across tabs:
     Tab : Request Info. -> Request Status (edit-request-status)
     Tab : Quotation Info. -> PR Reference (edit-prref)
     Tab : Contract Info. -> Charge CCC (edit-charge-ccc), Works Order Code (edit-works-order-code),
                             Account Code (edit-account-code), UM/Mgr (edit-um-mgr)
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

// ── 1. Static HTML verification across tabs ─────────────────────────────────

// Tab 1: Request Info -> Request Status
const tabRequestMatch = HTML.match(/<div id="tab-request"[\s\S]*?<\/div>\s*<\/div>\s*<\/div>\s*<!-- TAB 2/);
ok("Found tab-request container in HTML", !!tabRequestMatch);
const tabRequestHtml = tabRequestMatch ? tabRequestMatch[0] : "";
ok("Tab Request Info has disabled edit-request-status field",
  /<input[^>]*id="edit-request-status"[^>]*disabled/i.test(tabRequestHtml) ||
  /<input[^>]*disabled[^>]*id="edit-request-status"/i.test(tabRequestHtml));
ok("Tab Request Info has hidden container for Request Status",
  /<div[^>]*class="[^"]*\bhidden\b[^"]*"[^>]*>[\s\S]*?id="edit-request-status"/i.test(tabRequestHtml));

// Tab 2: Quotation Info -> PR Reference
const tabQuotationMatch = HTML.match(/<div id="tab-quotation"[\s\S]*?<\/div>\s*<\/div>\s*<\/div>\s*<!-- TAB 3/);
ok("Found tab-quotation container in HTML", !!tabQuotationMatch);
const tabQuotationHtml = tabQuotationMatch ? tabQuotationMatch[0] : "";
ok("Tab Quotation Info has disabled edit-prref field",
  /<input[^>]*id="edit-prref"[^>]*disabled/i.test(tabQuotationHtml) ||
  /<input[^>]*disabled[^>]*id="edit-prref"/i.test(tabQuotationHtml));
ok("Tab Quotation Info has hidden container for PR Reference",
  /<div[^>]*class="[^"]*\bhidden\b[^"]*"[^>]*>[\s\S]*?id="edit-prref"/i.test(tabQuotationHtml));

// Tab 3: Contract Info -> Charge CCC, Works Order Code, Account Code, UM/Mgr
const tabContractMatch = HTML.match(/<div id="tab-contract"[\s\S]*?<\/div>\s*<\/div>\s*<\/div>\s*<!-- TAB 4/);
ok("Found tab-contract container in HTML", !!tabContractMatch);
const tabContractHtml = tabContractMatch ? tabContractMatch[0] : "";

ok("Tab Contract Info has disabled edit-charge-ccc field",
  /<input[^>]*id="edit-charge-ccc"[^>]*disabled/i.test(tabContractHtml) ||
  /<input[^>]*disabled[^>]*id="edit-charge-ccc"/i.test(tabContractHtml));
ok("Tab Contract Info has hidden container for Charge CCC",
  /<div[^>]*class="[^"]*\bhidden\b[^"]*"[^>]*>[\s\S]*?id="edit-charge-ccc"/i.test(tabContractHtml));

ok("Tab Contract Info has disabled edit-works-order-code field",
  /<input[^>]*id="edit-works-order-code"[^>]*disabled/i.test(tabContractHtml) ||
  /<input[^>]*disabled[^>]*id="edit-works-order-code"/i.test(tabContractHtml));
ok("Tab Contract Info has hidden container for Works Order Code",
  /<div[^>]*class="[^"]*\bhidden\b[^"]*"[^>]*>[\s\S]*?id="edit-works-order-code"/i.test(tabContractHtml));

ok("Tab Contract Info has disabled edit-account-code field",
  /<input[^>]*id="edit-account-code"[^>]*disabled/i.test(tabContractHtml) ||
  /<input[^>]*disabled[^>]*id="edit-account-code"/i.test(tabContractHtml));
ok("Tab Contract Info has hidden container for Account Code",
  /<div[^>]*class="[^"]*\bhidden\b[^"]*"[^>]*>[\s\S]*?id="edit-account-code"/i.test(tabContractHtml));

ok("Tab Contract Info has disabled edit-um-mgr field",
  /<input[^>]*id="edit-um-mgr"[^>]*disabled/i.test(tabContractHtml) ||
  /<input[^>]*disabled[^>]*id="edit-um-mgr"/i.test(tabContractHtml));
ok("Tab Contract Info has hidden container for UM/Mgr",
  /<div[^>]*class="[^"]*\bhidden\b[^"]*"[^>]*>[\s\S]*?id="edit-um-mgr"/i.test(tabContractHtml));

// ── 2. Script execution & runtime locking verification ───────────────────────

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
      value: "",
      disabled: false,
      classList: {
        classes: new Set(),
        add(...c) { c.forEach(x => this.classes.add(x)); },
        remove(...c) { c.forEach(x => this.classes.delete(x)); },
        contains(c) { return this.classes.has(c); },
      },
      setAttribute() {},
      removeAttribute() {},
      addEventListener() {},
      removeEventListener() {},
      style: {},
      innerHTML: "",
      innerText: "",
      closest: () => null,
      scrollIntoView: () => {},
      focus: () => {},
      querySelectorAll: (sel) => {
        return [
          getMockElement('edit-request-status'),
          getMockElement('edit-prref'),
          getMockElement('edit-charge-ccc'),
          getMockElement('edit-works-order-code'),
          getMockElement('edit-account-code'),
          getMockElement('edit-um-mgr'),
          getMockElement('edit-customer'),
        ];
      }
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
    querySelector: (sel) => {
      if (sel === '#modalFormContainer') {
        return {
          querySelectorAll: () => [
            getMockElement('edit-request-status'),
            getMockElement('edit-prref'),
            getMockElement('edit-charge-ccc'),
            getMockElement('edit-works-order-code'),
            getMockElement('edit-account-code'),
            getMockElement('edit-um-mgr'),
            getMockElement('edit-customer'),
          ]
        };
      }
      return { innerHTML: "", querySelectorAll: () => [] };
    },
    querySelectorAll: () => [],
    createElement: () => ({ setAttribute() {}, appendChild() {}, remove: () => {}, click() {}, style: {} }),
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
  Set,
  Map,
};

vm.createContext(sandbox);
try {
  vm.runInContext(
    scriptMatch[1] +
    `
    window.EXPORTS = {
      PERMANENTLY_DISABLED_FIELD_IDS,
      applyPermanentlyDisabledFields,
      updateFieldLockingAndApprovalUI,
      STAGE_REQUIRED_FIELDS,
      validateRequiredFieldsForStage
    };
    `,
    sandbox
  );
  ok("Master page script parsed and loaded cleanly", true);
} catch (e) {
  console.error("FAIL: script execution threw:", e);
  process.exit(1);
}

const exp = sandbox.window.EXPORTS;
const disabledSet = exp.PERMANENTLY_DISABLED_FIELD_IDS;

ok("PERMANENTLY_DISABLED_FIELD_IDS contains edit-request-status", disabledSet.has("edit-request-status"));
ok("PERMANENTLY_DISABLED_FIELD_IDS contains edit-prref", disabledSet.has("edit-prref"));
ok("PERMANENTLY_DISABLED_FIELD_IDS contains edit-charge-ccc", disabledSet.has("edit-charge-ccc"));
ok("PERMANENTLY_DISABLED_FIELD_IDS contains edit-works-order-code", disabledSet.has("edit-works-order-code"));
ok("PERMANENTLY_DISABLED_FIELD_IDS contains edit-account-code", disabledSet.has("edit-account-code"));
ok("PERMANENTLY_DISABLED_FIELD_IDS contains edit-um-mgr", disabledSet.has("edit-um-mgr"));

// Test applyPermanentlyDisabledFields
exp.applyPermanentlyDisabledFields();
const reqStatus = getMockElement("edit-request-status");
const prRef = getMockElement("edit-prref");
const chargeCcc = getMockElement("edit-charge-ccc");
const woCode = getMockElement("edit-works-order-code");
const accCode = getMockElement("edit-account-code");
const umMgr = getMockElement("edit-um-mgr");

ok("applyPermanentlyDisabledFields disables edit-request-status", reqStatus.disabled === true);
ok("applyPermanentlyDisabledFields disables edit-prref", prRef.disabled === true);
ok("applyPermanentlyDisabledFields disables edit-charge-ccc", chargeCcc.disabled === true);
ok("applyPermanentlyDisabledFields disables edit-works-order-code", woCode.disabled === true);
ok("applyPermanentlyDisabledFields disables edit-account-code", accCode.disabled === true);
ok("applyPermanentlyDisabledFields disables edit-um-mgr", umMgr.disabled === true);

// Test that complete status does not re-enable permanently disabled fields
exp.updateFieldLockingAndApprovalUI("Complete");
ok("updateFieldLockingAndApprovalUI('Complete') keeps edit-request-status disabled", reqStatus.disabled === true);
ok("updateFieldLockingAndApprovalUI('Complete') keeps edit-prref disabled", prRef.disabled === true);
ok("updateFieldLockingAndApprovalUI('Complete') keeps edit-charge-ccc disabled", chargeCcc.disabled === true);
ok("updateFieldLockingAndApprovalUI('Complete') keeps edit-works-order-code disabled", woCode.disabled === true);
ok("updateFieldLockingAndApprovalUI('Complete') keeps edit-account-code disabled", accCode.disabled === true);
ok("updateFieldLockingAndApprovalUI('Complete') keeps edit-um-mgr disabled", umMgr.disabled === true);

// STAGE_REQUIRED_FIELDS check
const prReadyRequired = exp.STAGE_REQUIRED_FIELDS["PR No. Ready"] || [];
ok("STAGE_REQUIRED_FIELDS['PR No. Ready'] does not require edit-prref",
  !prReadyRequired.some(f => f.id === "edit-prref"));

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
} else {
  console.log("\nALL CHECKS PASSED: Disabled fields across different tabs verified successfully.");
}
