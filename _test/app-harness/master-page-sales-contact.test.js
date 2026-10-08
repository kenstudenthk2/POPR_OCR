/* master-page-sales-contact.test.js -- Verification for Sales Name & Contact Number lookup in Master page_21-Sep-2026.html
   Tests:
   1. SALES_CONTACT_LOOKUP_CONFIG targets table "cre5c_btb_sales_name__contact" and columns "admin_salesx0020name", "admin_salesx0020contactx0020number"
   2. getSalesRowName and getSalesRowContactNumber extract values correctly from Dataverse entity records
   3. fetchSalesContactRows retrieves and caches rows from Dataverse WebApi
   4. lookupSalesContactInfo resolves {Sales Name} and {Sales Contact Number} from Dataverse rows
   5. lookupSalesContactInfo falls back to BTB_SALES_CONTACTS when Dataverse is offline or not found
   6. interpolateRemark replaces {Sales Name} and {Sales Contact Number} (and {Issue by} / {Issue By Phone No.})
   7. openRemarkModal loads sales options and auto-matches handledBy
   8. Changing Sales Name via handleRemarkSalesContactChange dynamically updates To Supplier Remark
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
assert(html.includes("cre5c_btb_sales_name__contact"), "HTML includes table name 'cre5c_btb_sales_name__contact'");
assert(html.includes("admin_salesx0020name"), "HTML includes column name 'admin_salesx0020name'");
assert(html.includes("admin_salesx0020contactx0020number"), "HTML includes column name 'admin_salesx0020contactx0020number'");
assert(html.includes("{Sales Name}"), "HTML hint includes {Sales Name}");
assert(html.includes("{Sales Contact Number}"), "HTML hint includes {Sales Contact Number}");
assert(html.includes("admin_btb_admin_user_list"), "HTML includes table name 'admin_btb_admin_user_list'");
assert(html.includes("admin_admin1emailaddress"), "HTML includes column name 'admin_admin1emailaddress'");
assert(html.includes("{Issued by Email address}"), "HTML hint includes {Issued by Email address}");

// ── 2. Script Execution in Sandbox ───────────────────────────────────────────
const scriptMatch = html.match(/<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/i);
assert(!!scriptMatch, "Found embedded script in Master page_21-Sep-2026.html");

const mockSalesDataverseRows = [
  {
    admin_salesx0020name: "Leung, Sammi SM",
    admin_salesx0020contactx0020number: "28883130"
  },
  {
    admin_salesx0020name: "Chan, Abby NY",
    admin_salesx0020contactx0020number: "2883 0385"
  },
  {
    admin_salesx0020name: "Custom Agent John",
    admin_salesx0020contactx0020number: "98765432"
  }
];

const mockAdminUserDataverseRows = [
  {
    admin_admin1name: "Lee, Mandy MY",
    admin_admin1emailaddress: "mandy.my.lee@pccw.com"
  },
  {
    admin_admin1name: "Chow, Alice SW",
    admin_admin1emailaddress: "alice.sw.chow@pccw.com"
  }
];

const mockSupplierRemarkDataverseRows = [
  {
    admin_ccc: "Others",
    admin_reamrk: [
      "1) PR Issued by {Issue by}@{Issue By Phone No.}",
      "2) For case details, please contact  {Sales Name} {Sales Contact Number}",
      "3) Enduser: {Enduser}",
      "4) SI: {SI}",
      "5) Period: {Period}",
      "6) Purchase of {Purchase of}"
    ].join("\n")
  },
  {
    admin_ccc: "C600",
    admin_reamrk: [
      "1 {BTB Type}",
      "2. {UID #}",
      "3. Customer information as the below:",
      "   EU: {Enduser}",
      "   Address: {Customer Address}",
      "   Contact: {Customer Contact Person}"
    ].join("\n")
  }
];

const mockWebApi = {
  retrieveMultipleRecords: async (entity, query) => {
    if (entity === "cre5c_btb_sales_name__contact" || entity === "cre5c_btb_sales_name__contacts") {
      return { entities: mockSalesDataverseRows };
    }
    if (entity === "admin_btb_admin_user_list" || entity === "admin_btb_admin_user_lists") {
      return { entities: mockAdminUserDataverseRows };
    }
    if (entity === "admin_btb_supplier_remark" || entity === "admin_btb_supplier_remarks") {
      return { entities: mockSupplierRemarkDataverseRows };
    }
    if (entity === "admin_btb_lis_excel_datas" || entity === "admin_btb_lis_excel_data") {
      if (query && query.includes("ATQ-202608-00404-V01-1")) {
        return {
          entities: [
            {
              admin_title: "ATQ-202608-00404-V01-1",
              admin_btbtype: "BTB",
              admin_uidx0020x0023: "UID-8899"
            }
          ]
        };
      }
    }
    return { entities: [] };
  }
};

const domStore = {};
function getMockElement(id) {
  if (!domStore[id]) {
    domStore[id] = {
      id: id,
      value: "",
      innerText: "",
      innerHTML: "",
      classList: {
        classes: new Set(),
        add: function(c) { this.classes.add(c); },
        remove: function(c) { this.classes.delete(c); },
        contains: function(c) { return this.classes.has(c); },
        toggle: function(c, force) {
          if (force === undefined) {
            if (this.classes.has(c)) this.classes.delete(c);
            else this.classes.add(c);
          } else if (force) {
            this.classes.add(c);
          } else {
            this.classes.delete(c);
          }
        }
      },
      options: [],
      dataset: {},
      scrollIntoView: () => {},
      focus: () => {}
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
    Xrm: { WebApi: mockWebApi }
  },
  parent: {
    Xrm: { WebApi: mockWebApi }
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
      select: () => {}
    }),
    body: { appendChild: () => {}, removeChild: () => {}, execCommand: () => {} }
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
;EXPORTS.SALES_CONTACT_LOOKUP_CONFIG = SALES_CONTACT_LOOKUP_CONFIG;
EXPORTS.getSalesRowName = getSalesRowName;
EXPORTS.getSalesRowContactNumber = getSalesRowContactNumber;
EXPORTS.fetchSalesContactRows = fetchSalesContactRows;
EXPORTS.lookupSalesContactInfo = lookupSalesContactInfo;
EXPORTS.findSalesContactMatch = findSalesContactMatch;
EXPORTS.fetchRecordBtbAndUid = fetchRecordBtbAndUid;
EXPORTS.lookupAdminEmail = lookupAdminEmail;
EXPORTS.fetchAdminUserList = fetchAdminUserList;
EXPORTS.interpolateRemark = interpolateRemark;
EXPORTS.openRemarkModal = openRemarkModal;
EXPORTS.rebuildRemarksFromModalState = rebuildRemarksFromModalState;
EXPORTS.handleRemarkSalesContactChange = handleRemarkSalesContactChange;
EXPORTS.handleRemarkCaseTypeChange = handleRemarkCaseTypeChange;
EXPORTS.handleRemarkAdminNameChange = handleRemarkAdminNameChange;
EXPORTS.state = state;
`;

vm.createContext(sandbox);
vm.runInContext(SCRIPT_CODE, sandbox, { filename: "master-page-script.js" });

(async () => {
  // ── 3. Schema & Helper tests ───────────────────────────────────────────────
  const cfg = sandbox.EXPORTS.SALES_CONTACT_LOOKUP_CONFIG;
  assert(cfg.entity === "cre5c_btb_sales_name__contact", "SALES_CONTACT_LOOKUP_CONFIG uses entity 'cre5c_btb_sales_name__contact'");
  assert(cfg.select.includes("admin_salesx0020name"), "Config select includes 'admin_salesx0020name'");
  assert(cfg.select.includes("admin_salesx0020contactx0020number"), "Config select includes 'admin_salesx0020contactx0020number'");

  const getSalesRowName = sandbox.EXPORTS.getSalesRowName;
  const getSalesRowContactNumber = sandbox.EXPORTS.getSalesRowContactNumber;

  const testRow = {
    admin_salesx0020name: "  Leung, Sammi SM  ",
    admin_salesx0020contactx0020number: " 28883130 "
  };
  assert(getSalesRowName(testRow) === "Leung, Sammi SM", "getSalesRowName extracts and trims sales name");
  assert(getSalesRowContactNumber(testRow) === "28883130", "getSalesRowContactNumber extracts and trims contact number");

  // ── 4. Dataverse fetch & lookup tests ──────────────────────────────────────
  const fetchedRows = await sandbox.EXPORTS.fetchSalesContactRows();
  assert(Array.isArray(fetchedRows) && fetchedRows.length === 3, "fetchSalesContactRows retrieves records from Dataverse");

  const lookupSalesContactInfo = sandbox.EXPORTS.lookupSalesContactInfo;

  // Direct Dataverse lookup for Leung, Sammi SM (as in user screenshot)
  const sammiLookup = lookupSalesContactInfo("Leung, Sammi SM", fetchedRows);
  assert(sammiLookup.salesName === "Leung, Sammi SM", "lookupSalesContactInfo resolves Leung, Sammi SM name");
  assert(sammiLookup.salesContactNumber === "28883130", "lookupSalesContactInfo resolves Leung, Sammi SM number 28883130");

  // Lookup for custom Dataverse agent
  const customLookup = lookupSalesContactInfo("Custom Agent John", fetchedRows);
  assert(customLookup.salesName === "Custom Agent John", "lookupSalesContactInfo resolves custom Dataverse agent name");
  assert(customLookup.salesContactNumber === "98765432", "lookupSalesContactInfo resolves custom Dataverse agent number 98765432");

  // Fallback to static BTB_SALES_CONTACTS when not in Dataverse
  const staticLookup = lookupSalesContactInfo("Cheung, Sindy SY", []);
  assert(staticLookup.salesName === "Cheung, Sindy SY", "Fallback resolves Cheung, Sindy SY name");
  assert(staticLookup.salesContactNumber === "2883 6285", "Fallback resolves Cheung, Sindy SY phone number 2883 6285");

  // ── 5. interpolateRemark token replacement tests ───────────────────────────
  const interpolateRemark = sandbox.EXPORTS.interpolateRemark;
  const fields = {
    customerName: { value: "THE HONG KONG JOCKEY CLUB" },
    vendor: { value: "MTS Asia Ltd" },
    quotationStartDate: { value: "2026-06-30" },
    quotationEndDate: { value: "2027-06-29" },
    poPrDescription: { value: "Maintenance Renewal" },
    issueBy: { value: "Lee, Mandy MY" }
  };

  // Exact template from user screenshot:
  const screenshotTemplate = [
    "1) PR Issued by {Issue by}@{Issue By Phone No.}",
    "2) For case details, please contact  {Sales Name} {Sales Contact Number}",
    "3) Enduser: {Enduser}",
    "4) SI: {SI}",
    "5) Period: {Period}"
  ].join("\n");

  const sammiResult = interpolateRemark(screenshotTemplate, fields, null, "Lee, Mandy MY", sammiLookup);

  assert(
    sammiResult.includes("2) For case details, please contact  Leung, Sammi SM 28883130"),
    "interpolateRemark correctly interpolates {Sales Name} {Sales Contact Number} to 'Leung, Sammi SM 28883130'"
  );
  assert(
    sammiResult.includes("1) PR Issued by Lee, Mandy MY@28833100"),
    "interpolateRemark correctly interpolates {Issue by}@{Issue By Phone No.}"
  );
  assert(
    sammiResult.includes("3) Enduser: THE HONG KONG JOCKEY CLUB"),
    "interpolateRemark correctly interpolates Enduser"
  );
  assert(
    sammiResult.includes("4) SI: MTS Asia Ltd"),
    "interpolateRemark correctly interpolates SI"
  );

  // Lowercase & variant placeholders
  const variantTemplate = "Contact: {sales name} at {sales contact number} (alt: {sales contact no.})";
  const variantResult = interpolateRemark(variantTemplate, fields, null, null, sammiLookup);
  assert(
    variantResult === "Contact: Leung, Sammi SM at 28883130 (alt: 28883130)",
    "interpolateRemark handles lowercase {sales name} and {sales contact number}"
  );

  // ── 6. openRemarkModal & Dynamic Change Integration Test ───────────────────
  sandbox.EXPORTS.state.currentRecord = {
    Id: "ATQ-202605-00436-V01-2",
    Title: "ATQ-202605-00436-V01-2",
    CustomerName: "THE HONG KONG JOCKEY CLUB",
    Vendor: "MTS Asia Ltd",
    HandledBy: "Leung, Sammi SM",
    IssueBy: "Lee, Mandy MY",
    ChargeCCC: "Others",
    Remarks: ""
  };
  getMockElement("edit-title").value = "ATQ-202605-00436-V01-2";
  getMockElement("edit-customer").value = "THE HONG KONG JOCKEY CLUB";
  getMockElement("edit-vendor").value = "MTS Asia Ltd";
  getMockElement("edit-handledby").value = "Leung, Sammi SM";
  getMockElement("edit-issue-by").value = "Lee, Mandy MY";
  getMockElement("edit-quotation-start-date").value = "2026-06-30";
  getMockElement("edit-quotation-end-date").value = "2027-06-29";
  getMockElement("edit-pair-charge-ccc").value = "Others";

  await sandbox.EXPORTS.openRemarkModal();

  const salesSelect = getMockElement("remark-sales-contact");
  assert(salesSelect.value === "Leung, Sammi SM", "openRemarkModal auto-selects Leung, Sammi SM from HandledBy");

  const supplierTextarea = getMockElement("modal-supplier-remark");
  assert(
    supplierTextarea.value.includes("2) For case details, please contact  Leung, Sammi SM 28883130"),
    "Initial To Supplier Remark textarea contains resolved Leung, Sammi SM 28883130"
  );

  // User changes Sales Name to 'Chan, Abby NY'
  salesSelect.value = "Chan, Abby NY";
  await sandbox.EXPORTS.handleRemarkSalesContactChange("Chan, Abby NY");

  assert(
    supplierTextarea.value.includes("2) For case details, please contact  Chan, Abby NY 2883 0385"),
    "handleRemarkSalesContactChange dynamically updates To Supplier Remark to 'Chan, Abby NY 2883 0385'"
  );

  // User changes Sales Name to custom Dataverse agent
  salesSelect.value = "Custom Agent John";
  await sandbox.EXPORTS.handleRemarkSalesContactChange("Custom Agent John");

  assert(
    supplierTextarea.value.includes("2) For case details, please contact  Custom Agent John 98765432"),
    "handleRemarkSalesContactChange dynamically updates To Supplier Remark to custom Dataverse agent"
  );

  // ── 7. BTB Type and UID # Lookup Test (from clipboard-1791368443206.png) ────
  // Record: ATQ-202608-00404-V01-1, Case Type: C600
  // Template:
  // 1 {BTB Type}
  // 2. {UID #}
  // 3. Customer information as the below:
  //    EU: UNION HOSPITAL test

  const btbUidLookup = await sandbox.EXPORTS.fetchRecordBtbAndUid("ATQ-202608-00404-V01-1");
  assert(btbUidLookup.admin_btbtype === "BTB", "fetchRecordBtbAndUid resolves admin_btbtype to 'BTB'");
  assert(btbUidLookup.admin_uidx0020x0023 === "UID-8899", "fetchRecordBtbAndUid resolves admin_uidx0020x0023 to 'UID-8899'");

  sandbox.EXPORTS.state.currentRecord = {
    Id: "ATQ-202608-00404-V01-1",
    Title: "ATQ-202608-00404-V01-1",
    CustomerName: "UNION HOSPITAL test",
    Vendor: "Vendor ABC",
    HandledBy: "Leung, Sammi SM",
    IssueBy: "Lee, Mandy MY",
    ChargeCCC: "C600",
    Remarks: ""
  };
  getMockElement("edit-title").value = "ATQ-202608-00404-V01-1";
  getMockElement("edit-customer").value = "UNION HOSPITAL test";
  getMockElement("edit-vendor").value = "Vendor ABC";
  getMockElement("edit-handledby").value = "";
  getMockElement("edit-issue-by").value = "Lee, Mandy MY";
  getMockElement("edit-pair-charge-ccc").value = "C600";
  getMockElement("edit-btb").value = "";
  getMockElement("edit-uid").value = "";

  await sandbox.EXPORTS.openRemarkModal();

  const caseSelect = getMockElement("remark-case-type");
  caseSelect.value = "C600";
  await sandbox.EXPORTS.handleRemarkCaseTypeChange("C600");

  const c600SupplierTextarea = getMockElement("modal-supplier-remark");
  assert(
    c600SupplierTextarea.value.includes("1 BTB"),
    "To Supplier Remark interpolates {BTB Type} with looked up admin_btbtype 'BTB'"
  );
  assert(
    c600SupplierTextarea.value.includes("2. UID-8899"),
    "To Supplier Remark interpolates {UID #} with looked up admin_uidx0020x0023 'UID-8899'"
  );
  assert(
    c600SupplierTextarea.value.includes("EU: UNION HOSPITAL test"),
    "To Supplier Remark retains customer name 'UNION HOSPITAL test'"
  );

  // ── 8. Issued by Email address Lookup Test ────────────────────────────────
  const adminEmail = sandbox.EXPORTS.lookupAdminEmail("Lee, Mandy MY", mockAdminUserDataverseRows);
  assert(adminEmail === "mandy.my.lee@pccw.com", "lookupAdminEmail resolves 'mandy.my.lee@pccw.com'");

  const emailTemplate = "Contact admin: {Issue by} at {Issued by Email address}";
  const emailResult = interpolateRemark(emailTemplate, fields, null, "Lee, Mandy MY");
  assert(
    emailResult.includes("Contact admin: Lee, Mandy MY at mandy.my.lee@pccw.com"),
    "interpolateRemark replaces {Issued by Email address} with looked up admin_admin1emailaddress"
  );

  const aliceEmail = sandbox.EXPORTS.lookupAdminEmail("Chow, Alice SW", mockAdminUserDataverseRows);
  assert(aliceEmail === "alice.sw.chow@pccw.com", "lookupAdminEmail resolves 'alice.sw.chow@pccw.com' for Chow, Alice SW");

  console.log("\nALL CHECKS PASSED: Sales Name, Contact Number, BTB Type, UID #, and Issued by Email address lookups verified successfully.");
})();
