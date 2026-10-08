/* master-page-remark-fields.test.js
 * Verifies that in Master page_21-Sep-2026.html:
 * 1. Remark placeholders correctly match the record values:
 *    {Contract Start Date}       <-> admin_contractstartdate / StartDate
 *    {Contract End Date}         <-> admin_contractenddate / EndDate
 *    {Customer Address}          <-> admin_customeraddress / CustomerAddress
 *    {Customer Contact Person}   <-> admin_customercontactperson / CustomerContactPerson
 *    {Customer Contact No.}      <-> admin_customercontactno / CustomerContactNo
 *    {Customer Email Address}    <-> admin_customeremailaddress / CustomerEmailAddress
 *    {Quotation No}              <-> admin_quotationno / QuotationNo
 * 2. Form inputs for Customer Address, Contact Person, Contact No, Email Address exist.
 * 3. FIELD_ID_TO_RECORD_KEY, DV_COLUMN_MAP, getRemarkFields, and interpolateRemark support all 7 fields.
 * 4. Dataverse save persists these fields.
 */

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const HTML_PATH = path.resolve(__dirname, "../../Master page_21-Sep-2026.html");
const HTML = fs.readFileSync(HTML_PATH, "utf8");

let failures = 0;
const eq = (label, a, b) => {
  if (a === b) {
    console.log("OK   " + label);
    return;
  }
  failures++;
  console.error("FAIL " + label + "\n     expected " + JSON.stringify(b) + "\n     actual   " + JSON.stringify(a));
};
const ok = (label, cond, detail) => {
  if (cond) {
    console.log("OK   " + label);
    return;
  }
  failures++;
  console.error("FAIL " + label + (detail !== undefined ? "\n     got: " + JSON.stringify(detail) : ""));
};

// 1. Static HTML checks
ok("Customer Address input #edit-customer-address exists", HTML.includes('id="edit-customer-address"'));
ok("Customer Contact Person input #edit-customer-contact-person exists", HTML.includes('id="edit-customer-contact-person"'));
ok("Customer Contact No. input #edit-customer-contact-no exists", HTML.includes('id="edit-customer-contact-no"'));
ok("Customer Email Address input #edit-customer-email-address exists", HTML.includes('id="edit-customer-email-address"'));
ok("Remark auto-match hint includes {Contract Start Date}", HTML.includes('{Contract Start Date}'));
ok("Remark auto-match hint includes {Customer Address}", HTML.includes('{Customer Address}'));

// 2. JavaScript script execution & data mappings
const scriptMatch = HTML.match(/<script>([\s\S]*?)<\/script>[\s\S]*?<\/body>/);
if (!scriptMatch) {
  console.error("FAIL: Could not extract script from Master page_21-Sep-2026.html");
  process.exit(1);
}

const updatedRecords = [];
const mockWebApi = {
  retrieveMultipleRecords: async () => ({ entities: [] }),
  updateRecord: async (entity, id, payload) => {
    updatedRecords.push({ entity, id, payload });
    return { id };
  }
};

const domStore = {};
function createMockEl(id, tagName = "input") {
  return {
    id,
    tagName: tagName.toUpperCase(),
    value: "",
    checked: false,
    disabled: false,
    classList: {
      add: () => {},
      remove: () => {},
      contains: () => false
    },
    style: {},
    options: [],
    setAttribute: () => {},
    removeAttribute: () => {},
    closest: () => null,
    addEventListener: () => {}
  };
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
    Xrm: { WebApi: mockWebApi }
  },
  parent: {
    Xrm: { WebApi: mockWebApi }
  },
  Xrm: { WebApi: mockWebApi },
  document: {
    addEventListener: () => {},
    getElementById: (id) => {
      if (!domStore[id]) {
        domStore[id] = createMockEl(id);
      }
      return domStore[id];
    },
    querySelector: () => null,
    querySelectorAll: () => []
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
  EXPORTS: {}
};
sandbox.globalThis = sandbox;

const SCRIPT_CODE = scriptMatch[1] + `
;EXPORTS.COLUMN_CONFIG = COLUMN_CONFIG;
EXPORTS.DV_COLUMN_MAP = DV_COLUMN_MAP;
EXPORTS.FIELD_ID_TO_RECORD_KEY = FIELD_ID_TO_RECORD_KEY;
EXPORTS.interpolateRemark = interpolateRemark;
EXPORTS.getRemarkFields = getRemarkFields;
EXPORTS.persistRecordToDataverse = persistRecordToDataverse;
EXPORTS.state = state;
`;

vm.createContext(sandbox);
vm.runInContext(SCRIPT_CODE, sandbox, { filename: "master-page-script.js" });

// 3. Schema & Mapping checks
const dvMap = sandbox.EXPORTS.DV_COLUMN_MAP;
eq("DV_COLUMN_MAP maps admin_contractstartdate to StartDate", dvMap["admin_contractstartdate"], "StartDate");
eq("DV_COLUMN_MAP maps admin_contractenddate to EndDate", dvMap["admin_contractenddate"], "EndDate");
eq("DV_COLUMN_MAP maps admin_customeraddress to CustomerAddress", dvMap["admin_customeraddress"], "CustomerAddress");
eq("DV_COLUMN_MAP maps admin_customercontactperson to CustomerContactPerson", dvMap["admin_customercontactperson"], "CustomerContactPerson");
eq("DV_COLUMN_MAP maps admin_customercontactno to CustomerContactNo", dvMap["admin_customercontactno"], "CustomerContactNo");
eq("DV_COLUMN_MAP maps admin_customeremailaddress to CustomerEmailAddress", dvMap["admin_customeremailaddress"], "CustomerEmailAddress");
eq("DV_COLUMN_MAP maps admin_quotationno to QuotationNo", dvMap["admin_quotationno"], "QuotationNo");

const fieldMap = sandbox.EXPORTS.FIELD_ID_TO_RECORD_KEY;
eq("FIELD_ID_TO_RECORD_KEY maps edit-customer-address", fieldMap["edit-customer-address"], "CustomerAddress");
eq("FIELD_ID_TO_RECORD_KEY maps edit-customer-contact-person", fieldMap["edit-customer-contact-person"], "CustomerContactPerson");
eq("FIELD_ID_TO_RECORD_KEY maps edit-customer-contact-no", fieldMap["edit-customer-contact-no"], "CustomerContactNo");
eq("FIELD_ID_TO_RECORD_KEY maps edit-customer-email-address", fieldMap["edit-customer-email-address"], "CustomerEmailAddress");

// 4. Token interpolation test via fields object
const interpolateRemark = sandbox.EXPORTS.interpolateRemark;
const testFields = {
  contractStartDate: { value: "2026-05-01" },
  contractEndDate: { value: "2027-04-30" },
  customerAddress: { value: "100 King's Road, North Point, HK" },
  customerContactPerson: { value: "Mr. David Wong" },
  customerContactNo: { value: "2888 1234" },
  customerEmailAddress: { value: "david.wong@example.com" },
  quotationNo: { value: "QT-2026-8888" },
  customerName: { value: "PCCW Solutions" },
  vendor: { value: "Cisco Systems" }
};

const template = [
  "Contract: {Contract Start Date} to {Contract End Date}",
  "Address: {Customer Address}",
  "Contact: {Customer Contact Person} / {Customer Contact No.}",
  "Email: {Customer Email Address}",
  "Quote: {Quotation No}"
].join("\n");

const interpolated = interpolateRemark(template, testFields);
ok("Interpolates {Contract Start Date}", interpolated.includes("Contract: 2026-05-01 to 2027-04-30"), interpolated);
ok("Interpolates {Customer Address}", interpolated.includes("Address: 100 King's Road, North Point, HK"), interpolated);
ok("Interpolates {Customer Contact Person} and {Customer Contact No.}", interpolated.includes("Contact: Mr. David Wong / 2888 1234"), interpolated);
ok("Interpolates {Customer Email Address}", interpolated.includes("Email: david.wong@example.com"), interpolated);
ok("Interpolates {Quotation No}", interpolated.includes("Quote: QT-2026-8888"), interpolated);

// Test variants: without dot in contact no, with dot in quotation no
const altTemplate = "NoDot: {Customer Contact No}, QuoteDot: {Quotation No.}";
const altResult = interpolateRemark(altTemplate, testFields);
eq("Interpolates {Customer Contact No} without dot", altResult.includes("NoDot: 2888 1234"), true);
eq("Interpolates {Quotation No.} with dot", altResult.includes("QuoteDot: QT-2026-8888"), true);

// Test BTB Type conversion in remark: "BTB" -> "Back-to-Back", "Non-BTB" / "NON-BTB" -> "Non Back-To-Back"
const btbResult1 = interpolateRemark("Type: {BTB Type}", { btbType: { value: "BTB" } });
eq("Interpolates {BTB Type} 'BTB' to 'Back-to-Back'", btbResult1, "Type: Back-to-Back");

const btbResult2 = interpolateRemark("Type: {BTB Type}", { btbType: { value: "Non-BTB" } });
eq("Interpolates {BTB Type} 'Non-BTB' to 'Non Back-To-Back'", btbResult2, "Type: Non Back-To-Back");

const btbResult3 = interpolateRemark("Type: {btb}", { btbType: { value: "NON-BTB" } });
eq("Interpolates {btb} 'NON-BTB' to 'Non Back-To-Back'", btbResult3, "Type: Non Back-To-Back");

// 5. Test interpolation falling back directly to state.currentRecord (e.g. from Dataverse column names)
sandbox.EXPORTS.state.currentRecord = {
  Id: "REC-999",
  admin_contractstartdate: "2026-06-01",
  admin_contractenddate: "2027-05-31",
  admin_customeraddress: "Floor 39, PCCW Tower",
  admin_customercontactperson: "Ms. Karen Lee",
  admin_customercontactno: "98765432",
  admin_customeremailaddress: "karen.lee@pccw.com",
  admin_quotationno: "QUOT-9999"
};

const recordTemplate = [
  "{Contract Start Date}|{Contract End Date}|{Customer Address}|{Customer Contact Person}|{Customer Contact No.}|{Customer Email Address}|{Quotation No}"
].join("");

const recordResult = interpolateRemark(recordTemplate, {});
eq("Interpolates from currentRecord dataverse attributes",
  recordResult,
  "2026-06-01|2027-05-31|Floor 39, PCCW Tower|Ms. Karen Lee|98765432|karen.lee@pccw.com|QUOT-9999"
);

// 6. Test Dataverse save persists these fields
(async () => {
  const testRec = {
    Id: "REC-DV-SAVE",
    dataverseId: "guid-dv-save",
    CustomerAddress: "123 Test St",
    CustomerContactPerson: "Tester Bob",
    CustomerContactNo: "12345678",
    CustomerEmailAddress: "bob@test.com",
    StartDate: "2026-01-01",
    EndDate: "2026-12-31",
    QuotationNo: "Q-12345"
  };

  await sandbox.EXPORTS.persistRecordToDataverse(testRec);

  const lastUpdate = updatedRecords[updatedRecords.length - 1];
  ok("persistRecordToDataverse called WebApi.updateRecord", !!lastUpdate);
  if (lastUpdate) {
    eq("payload has admin_customeraddress", lastUpdate.payload.admin_customeraddress, "123 Test St");
    eq("payload has admin_customercontactperson", lastUpdate.payload.admin_customercontactperson, "Tester Bob");
    eq("payload has admin_customercontactno", lastUpdate.payload.admin_customercontactno, "12345678");
    eq("payload has admin_customeremailaddress", lastUpdate.payload.admin_customeremailaddress, "bob@test.com");
    eq("payload has admin_contractstartdate", lastUpdate.payload.admin_contractstartdate, "2026-01-01");
    eq("payload has admin_contractenddate", lastUpdate.payload.admin_contractenddate, "2026-12-31");
    eq("payload has admin_quotationno", lastUpdate.payload.admin_quotationno, "Q-12345");
  }

  if (failures > 0) {
    console.error(`\nFAILED: ${failures} check(s) failed.`);
    process.exit(1);
  } else {
    console.log("\nALL CHECKS PASSED: Remark fields auto-match verified successfully.");
  }
})();
