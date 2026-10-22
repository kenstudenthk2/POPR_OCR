/* master-page-pr-approval.test.js -- Verification for PR Approval Status UI Duplication & Approver Roles Display
   ----------------------------------------------------------------------------------------------------------------
   Verifies:
   1. Duplication of red warning text and "Send Approval Request" button in "PR Approval Status" section.
   2. "Send Approval Request" button in "PR Approval Status" calls the PR approval handler.
   3. Below the button, approval information for AVP, VP, SVP, MD is rendered in order AVP > VP > SVP > MD when columns have value.
   4. Dataverse columns mapping in DV_COLUMN_MAP:
      - admin_avpapprovalname, admin_avpapproveddatetime
      - admin_vpapprovalname, admin_vpapproveddatetime
      - admin_svpapprovalname, admin_svpapproveddatetime
      - admin_mdapprovalname, admin_mdapproveddatetime
   5. Dynamic display logic hides roles when values are empty and shows roles when values exist.
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
ok("prApprovalSection exists in HTML", HTML.includes('id="prApprovalSection"'));

// Find prApprovalSection in HTML
const prSectionMatch = HTML.match(/<div[^>]*id="prApprovalSection"[^>]*>([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>\s*<\/div>\s*<!-- TAB 5/);
ok("Found prApprovalSection content in HTML", Boolean(prSectionMatch));
const prSectionHtml = prSectionMatch ? prSectionMatch[1] : "";

// Check red text in PR Approval Status
const redWarningText = "**Before sending the approval request, please review the Attachment URL to ensure that the folder contains all required attachments.**";
ok("Red warning text duplicated in PR Approval Status", prSectionHtml.includes(redWarningText));
ok("Red text has bold and red styling", prSectionHtml.includes('text-[var(--red)]') && prSectionHtml.includes(redWarningText));

// Check button in PR Approval Status
ok("btn-send-pr-approval button exists in PR Approval Section", prSectionHtml.includes('id="btn-send-pr-approval"'));
const btnMatch = prSectionHtml.match(/<button[^>]*id="btn-send-pr-approval"[^>]*>([\s\S]*?)<\/button>/);
ok("Button has text 'Send Approval Request'", btnMatch && btnMatch[1].includes("Send Approval Request"));
ok("Button calls PR approval handler", btnMatch && btnMatch[0].includes('onclick="sendPRApprovalRequest()"'));

// Check roles approval info container and element IDs
ok("pr-roles-approval-info container exists", prSectionHtml.includes('id="pr-roles-approval-info"'));
ok("AVP container exists", prSectionHtml.includes('id="pr-approval-info-avp"'));
ok("VP container exists", prSectionHtml.includes('id="pr-approval-info-vp"'));
ok("SVP container exists", prSectionHtml.includes('id="pr-approval-info-svp"'));
ok("MD container exists", prSectionHtml.includes('id="pr-approval-info-md"'));

// Check relative order in HTML: red text < button < pr-roles-approval-info
const redPos = prSectionHtml.indexOf(redWarningText);
const btnPos = prSectionHtml.indexOf('id="btn-send-pr-approval"');
const rolesPos = prSectionHtml.indexOf('id="pr-roles-approval-info"');
ok("Red warning text appears before Send Approval button", redPos !== -1 && btnPos !== -1 && redPos < btnPos);
ok("Roles approval info appears below Send Approval button", btnPos !== -1 && rolesPos !== -1 && btnPos < rolesPos);

// Check order of roles: AVP < VP < SVP < MD
const avpPos = prSectionHtml.indexOf('id="pr-approval-info-avp"');
const vpPos = prSectionHtml.indexOf('id="pr-approval-info-vp"');
const svpPos = prSectionHtml.indexOf('id="pr-approval-info-svp"');
const mdPos = prSectionHtml.indexOf('id="pr-approval-info-md"');
ok("AVP precedes VP", avpPos !== -1 && vpPos !== -1 && avpPos < vpPos);
ok("VP precedes SVP", vpPos !== -1 && svpPos !== -1 && vpPos < svpPos);
ok("SVP precedes MD", svpPos !== -1 && mdPos !== -1 && svpPos < mdPos);

// Check MD approval input fields in PR Approval Status
ok("pr-md-approval-fields container exists", prSectionHtml.includes('id="pr-md-approval-fields"'));
ok("edit-md-name dropdown exists", prSectionHtml.includes('id="edit-md-name"'));
ok("edit-md-name has option 'Coming Soon'", prSectionHtml.includes('Coming Soon'));
ok("edit-md-approve-date input exists", prSectionHtml.includes('id="edit-md-approve-date"'));
ok("edit-md-approve-date is a date input", /<input[^>]*type="date"[^>]*id="edit-md-approve-date"/.test(prSectionHtml) || /<input[^>]*id="edit-md-approve-date"[^>]*type="date"/.test(prSectionHtml));

// 2. Evaluate script and check mappings
const scriptMatch = HTML.match(/<script>([\s\S]*?)<\/script>[\s\S]*?<\/body>/);
if (!scriptMatch) {
  console.error("FAIL: could not extract script block from " + HTML_PATH);
  process.exit(1);
}

const scriptCode = scriptMatch[1] + `
;this.EXPORTS = {
  DV_COLUMN_MAP,
  FIELD_ID_TO_RECORD_KEY,
  updatePRApprovalRolesUI: typeof updatePRApprovalRolesUI !== 'undefined' ? updatePRApprovalRolesUI : undefined,
  updateMDApprovalUI: typeof updateMDApprovalUI !== 'undefined' ? updateMDApprovalUI : undefined
};
`;

const domElements = new Map();
function getMockElement(id) {
  if (!domElements.has(id)) {
    domElements.set(id, {
      id,
      innerText: "",
      textContent: "",
      value: "",
      classList: {
        classes: new Set(["hidden"]),
        remove(...cls) { cls.forEach(c => this.classes.delete(c)); },
        add(...cls) { cls.forEach(c => this.classes.add(c)); },
        contains(c) { return this.classes.has(c); },
      },
      style: {},
      children: [],
      appendChild(child) { this.children.push(child); return child; },
      setAttribute() {},
      removeAttribute() {},
      addEventListener() {},
      querySelector() { return null; },
      querySelectorAll() { return []; },
    });
  }
  return domElements.get(id);
}

const sandbox = {
  console,
  setTimeout: () => {},
  clearTimeout: () => {},
  setInterval: () => {},
  clearInterval: () => {},
  document: {
    getElementById: (id) => getMockElement(id),
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: () => {},
    removeEventListener: () => {},
    createElement: (tag) => ({
      tagName: tag.toUpperCase(),
      classList: { classes: new Set(), add(...c) { c.forEach(x => this.classes.add(x)); }, remove(...c) { c.forEach(x => this.classes.delete(c)); }, contains(c) { return this.classes.has(c); } },
      setAttribute() {},
      removeAttribute() {},
      style: {},
      appendChild() {},
    }),
    body: {
      classList: { classes: new Set(), add(...c) { c.forEach(x => this.classes.add(x)); }, remove(...c) { c.forEach(x => this.classes.delete(c)); } }
    }
  },
  window: {
    addEventListener: () => {},
  },
  location: { search: "" },
  history: { pushState: () => {}, replaceState: () => {} },
  navigator: {},
  Xrm: null,
};

sandbox.window.document = sandbox.document;
sandbox.window.location = sandbox.location;
sandbox.window.history = sandbox.history;

try {
  vm.createContext(sandbox);
  vm.runInContext(scriptCode, sandbox);
  console.log("OK   Master page script evaluated cleanly");
} catch (e) {
  console.error("FAIL: Script evaluation threw error:", e);
  process.exit(1);
}

// Check DV_COLUMN_MAP
const DV = sandbox.EXPORTS.DV_COLUMN_MAP;
ok("DV_COLUMN_MAP maps admin_avpapprovalname", DV && DV["admin_avpapprovalname"] === "AVPApprovalName");
ok("DV_COLUMN_MAP maps admin_avpapproveddatetime", DV && DV["admin_avpapproveddatetime"] === "AVPApprovedDateTime");
ok("DV_COLUMN_MAP maps admin_vpapprovalname", DV && DV["admin_vpapprovalname"] === "VPApprovalName");
ok("DV_COLUMN_MAP maps admin_vpapproveddatetime", DV && DV["admin_vpapproveddatetime"] === "VPApprovedDateTime");
ok("DV_COLUMN_MAP maps admin_svpapprovalname", DV && DV["admin_svpapprovalname"] === "SVPApprovalName");
ok("DV_COLUMN_MAP maps admin_svpapproveddatetime", DV && DV["admin_svpapproveddatetime"] === "SVPApprovedDateTime");
ok("DV_COLUMN_MAP maps admin_mdapprovalname", DV && DV["admin_mdapprovalname"] === "MDApprovalName");
ok("DV_COLUMN_MAP maps admin_mdapproveddatetime", DV && DV["admin_mdapproveddatetime"] === "MDApprovedDateTime");

// Check updatePRApprovalRolesUI function
ok("updatePRApprovalRolesUI is defined", typeof sandbox.updatePRApprovalRolesUI === "function");

if (typeof sandbox.updatePRApprovalRolesUI === "function") {
  // Test case 1: Record with no approval info
  const emptyRecord = { Id: "1", Title: "TEST-EMPTY" };
  sandbox.updatePRApprovalRolesUI(emptyRecord);
  const rolesContainer = getMockElement("pr-roles-approval-info");
  ok("No values: roles container is hidden", rolesContainer.classList.contains("hidden"));
  ok("No values: AVP container is hidden", getMockElement("pr-approval-info-avp").classList.contains("hidden"));
  ok("No values: VP container is hidden", getMockElement("pr-approval-info-vp").classList.contains("hidden"));
  ok("No values: SVP container is hidden", getMockElement("pr-approval-info-svp").classList.contains("hidden"));
  ok("No values: MD container is hidden", getMockElement("pr-approval-info-md").classList.contains("hidden"));

  // Test case 2: Record with AVP values only
  const avpRecord = {
    Id: "2",
    Title: "TEST-AVP",
    AVPApprovalName: "Lai, Kelvin KW",
    AVPApprovedDateTime: "2026-10-09T15:39:09Z"
  };
  sandbox.updatePRApprovalRolesUI(avpRecord);
  ok("AVP present: roles container is visible", !rolesContainer.classList.contains("hidden"));
  ok("AVP present: AVP container is visible", !getMockElement("pr-approval-info-avp").classList.contains("hidden"));
  eq("AVP name populated", getMockElement("pr-approval-avp-name").textContent, "Lai, Kelvin KW");
  ok("AVP date populated and formatted", getMockElement("pr-approval-avp-date").textContent.includes("09/10/2026"));
  ok("AVP present: VP container remains hidden", getMockElement("pr-approval-info-vp").classList.contains("hidden"));
  ok("AVP present: SVP container remains hidden", getMockElement("pr-approval-info-svp").classList.contains("hidden"));
  ok("AVP present: MD container remains hidden", getMockElement("pr-approval-info-md").classList.contains("hidden"));

  // Test case 3: Record with raw Dataverse attribute names
  const dvRawRecord = {
    Id: "3",
    Title: "TEST-RAW",
    admin_vpapprovalname: "Wong, Sarah",
    admin_vpapproveddatetime: "09/10/2026 16:00:00",
    admin_mdapprovalname: "Chan, David",
    admin_mdapproveddatetime: "10/10/2026 10:15:30"
  };
  sandbox.updatePRApprovalRolesUI(dvRawRecord);
  ok("VP container visible with raw DV field", !getMockElement("pr-approval-info-vp").classList.contains("hidden"));
  eq("VP name populated from raw DV field", getMockElement("pr-approval-vp-name").textContent, "Wong, Sarah");
  ok("AVP container hidden when empty", getMockElement("pr-approval-info-avp").classList.contains("hidden"));
  ok("SVP container hidden when empty", getMockElement("pr-approval-info-svp").classList.contains("hidden"));
  ok("MD container visible with raw DV field", !getMockElement("pr-approval-info-md").classList.contains("hidden"));
  eq("MD name populated from raw DV field", getMockElement("pr-approval-md-name").textContent, "Chan, David");

  // Test case 4: Only name has value (date empty)
  const nameOnlyRecord = {
    Id: "4",
    Title: "TEST-NAME-ONLY",
    AVPApprovalName: "Solo Approver",
    AVPApprovedDateTime: ""
  };
  sandbox.updatePRApprovalRolesUI(nameOnlyRecord);
  ok("AVP container visible with name only", !getMockElement("pr-approval-info-avp").classList.contains("hidden"));
  ok("AVP name row visible", !getMockElement("pr-approval-avp-name-row").classList.contains("hidden"));
  ok("AVP date row hidden when empty", getMockElement("pr-approval-avp-date-row").classList.contains("hidden"));
}

// Check FIELD_ID_TO_RECORD_KEY mappings for MD approval fields
const FKEY = sandbox.EXPORTS.FIELD_ID_TO_RECORD_KEY;
ok("FIELD_ID_TO_RECORD_KEY maps edit-md-name to MDApprovalName", FKEY && FKEY["edit-md-name"] === "MDApprovalName");
ok("FIELD_ID_TO_RECORD_KEY maps edit-md-approve-date to MDApprovedDateTime", FKEY && FKEY["edit-md-approve-date"] === "MDApprovedDateTime");

// Check updateMDApprovalUI function
ok("updateMDApprovalUI is defined", typeof sandbox.EXPORTS.updateMDApprovalUI === "function");
if (typeof sandbox.EXPORTS.updateMDApprovalUI === "function") {
  const btn = getMockElement("btn-send-pr-approval");
  const warn = getMockElement("pr-approval-send-warning");
  const mdFields = getMockElement("pr-md-approval-fields");
  const mdName = getMockElement("edit-md-name");
  const mdDate = getMockElement("edit-md-approve-date");

  // Initial state: reset
  btn.classList.remove("hidden");
  warn.classList.remove("hidden");
  mdFields.classList.add("hidden");
  mdName.value = "";
  mdDate.value = "";

  // 1. When approval level is MD
  sandbox.EXPORTS.updateMDApprovalUI("MD");
  ok("Approval Level MD: btn-send-pr-approval is hidden", btn.classList.contains("hidden"));
  ok("Approval Level MD: pr-approval-send-warning is hidden", warn.classList.contains("hidden"));
  ok("Approval Level MD: pr-md-approval-fields is visible", !mdFields.classList.contains("hidden"));
  eq("Approval Level MD: edit-md-name defaults to Coming Soon", mdName.value, "Coming Soon");
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  eq("Approval Level MD: edit-md-approve-date defaults to today", mdDate.value, todayStr);

  // 2. When approval level is non-MD (e.g. VP)
  sandbox.EXPORTS.updateMDApprovalUI("VP");
  ok("Approval Level VP: btn-send-pr-approval is visible", !btn.classList.contains("hidden"));
  ok("Approval Level VP: pr-approval-send-warning is visible", !warn.classList.contains("hidden"));
  ok("Approval Level VP: pr-md-approval-fields is hidden", mdFields.classList.contains("hidden"));
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
} else {
  console.log("\nALL CHECKS PASSED: PR Approval Status UI duplication and roles display verified successfully.");
}
