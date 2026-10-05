/* master-page-cos-control.test.js -- COS control file verification for Master page_21-Sep-2026.html
   --------------------------------------------------------------------------------------------------
   Verifies that Master page_21-Sep-2026.html includes the "COS Control File" button function,
   the simplified modal dialog without month/extra-row inputs, and generates Excel containing
   only the filtered records that do NOT have the SB Report Generated checkbox ticked.
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

// 1. Markup verification
ok("Main navigation has COS Control File button",
  HTML.includes('onclick="openCosControlModal()"') && HTML.includes('📋 COS Control File'));

ok("Excel View modal header has COS Control File button",
  HTML.includes('onclick="openCosControlModal()"') && HTML.includes('id="excelViewModal"'));

ok("COS Control File modal exists in the document",
  HTML.includes('id="cosControlModal"'));

ok("Month picker input removed from modal",
  !HTML.includes('id="cos-month"'));

ok("Extra rows input removed from modal",
  !HTML.includes('id="cos-rows"'));

ok("Modal has month select input",
  HTML.includes('id="cos-month-select"'));

ok("Modal has From date picker",
  HTML.includes('id="cos-date-from"'));

ok("Modal has To date picker",
  HTML.includes('id="cos-date-to"'));

ok("Modal has Select All checkbox",
  HTML.includes('id="cos-table-select-all"'));

ok("Modal has records tbody",
  HTML.includes('id="cos-records-tbody"'));

ok("Summary display elements exist",
  HTML.includes('id="cos-file-name"') &&
  HTML.includes('id="cos-matched-rows-count"'));

ok("Generate button exists with handler",
  HTML.includes('id="btn-generate-cos"') && HTML.includes('onclick="generateCosControlFile()"'));

// 2. Extract and evaluate script block
const scriptMatch = HTML.match(/<script>([\s\S]*?)<\/script>[\s\S]*?<\/body>/);
if (!scriptMatch) {
  console.error("FAIL: could not extract script block from " + HTML_PATH);
  process.exit(1);
}

let downloadedFiles = [];
const elements = {};
const getElem = (id) => {
  if (!elements[id]) {
    elements[id] = {
      id,
      innerText: "",
      innerHTML: "",
      value: "",
      checked: false,
      disabled: false,
      classList: { remove() {}, add() {}, contains: () => false },
      appendChild: () => {},
      removeChild: () => {},
    };
  }
  return elements[id];
};

const sandbox = {
  console,
  setTimeout, clearTimeout,
  TextEncoder, Uint8Array,
  window: { addEventListener() {}, localStorage: { getItem: () => null, setItem: () => {} } },
  document: {
    addEventListener() {},
    getElementById: (id) => getElem(id),
    createElement: () => ({
      setAttribute() {},
      appendChild() {},
      remove: () => {},
      click() {},
      style: {},
      classList: { remove() {}, add() {}, contains: () => false },
      set href(val) {},
      set download(name) { downloadedFiles.push(name); }
    }),
    body: { appendChild() {}, removeChild() {} },
  },
  URL: { createObjectURL: () => "blob:fake", revokeObjectURL: () => {} },
  Blob: function(parts, opts) { this.parts = parts; this.opts = opts; },
  Date,
  Math,
  String,
  Number,
  Array,
  Object,
  JSON,
  EXPORTS: {},
};
sandbox.globalThis = sandbox;

const SCRIPT_CODE = scriptMatch[1] + `
;EXPORTS.state = state;
EXPORTS.cosModalState = cosModalState;
EXPORTS.COS_CONTROL_COLUMNS = COS_CONTROL_COLUMNS;
EXPORTS.COS_EMPTY_CELL = COS_EMPTY_CELL;
EXPORTS.cosCellText = cosCellText;
EXPORTS.fmtLisDate = fmtLisDate;
EXPORTS.isSBReportGenerated = isSBReportGenerated;
EXPORTS.getRecordDateNormalized = getRecordDateNormalized;
EXPORTS.initCosModalDates = initCosModalDates;
EXPORTS.handleCosMonthChange = handleCosMonthChange;
EXPORTS.handleCosDateRangeChange = handleCosDateRangeChange;
EXPORTS.toggleCosSelectAll = toggleCosSelectAll;
EXPORTS.selectCosUngeneratedOnly = selectCosUngeneratedOnly;
EXPORTS.handleCosRowCheckboxChange = handleCosRowCheckboxChange;
EXPORTS.cosControlRowValues = cosControlRowValues;
EXPORTS.cosControlRowsFrom = cosControlRowsFrom;
EXPORTS.cosRecdMonth = cosRecdMonth;
EXPORTS.cosControlRowsFor = cosControlRowsFor;
EXPORTS.cosReportMonth = cosReportMonth;
EXPORTS.cosControlFileName = cosControlFileName;
EXPORTS.buildCosStylesXml = buildCosStylesXml;
EXPORTS.buildCosSheetXml = buildCosSheetXml;
EXPORTS.crc32 = crc32;
EXPORTS.zipStore = zipStore;
EXPORTS.buildCosControlXlsx = buildCosControlXlsx;
EXPORTS.downloadCosControlFile = downloadCosControlFile;
EXPORTS.updateCosControlModalUI = updateCosControlModalUI;
EXPORTS.generateCosControlFile = generateCosControlFile;
EXPORTS.saveSBReportGeneratedToDataverse = saveSBReportGeneratedToDataverse;
EXPORTS.getDataverseWebApi = getDataverseWebApi;
`;

try {
  vm.createContext(sandbox);
  vm.runInContext(SCRIPT_CODE, sandbox, { filename: "master-page-script.js" });
} catch (e) {
  console.error("FAIL: script body threw at load time:\n" + e.stack);
  process.exit(1);
}
console.log("OK   script body evaluated cleanly");

const X = sandbox.EXPORTS;

// Unzip utility for test validation
function unzipStored(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let i = bytes.length - 22; i >= 0; i--) { if (dv.getUint32(i, true) === 0x06054b50) { end = i; break; } }
  if (end < 0) throw new Error("no end-of-central-directory record");
  const count = dv.getUint16(end + 10, true);
  let at = dv.getUint32(end + 16, true);
  const out = {};
  for (let i = 0; i < count; i++) {
    if (dv.getUint32(at, true) !== 0x02014b50) throw new Error("bad central directory header at " + at);
    const method = dv.getUint16(at + 10, true);
    if (method !== 0) throw new Error("entry is not STORED");
    const size = dv.getUint32(at + 24, true);
    const nameLen = dv.getUint16(at + 28, true);
    const extraLen = dv.getUint16(at + 30, true);
    const local = dv.getUint32(at + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLen));
    if (dv.getUint32(local, true) !== 0x04034b50) throw new Error("bad local header for " + name);
    const lNameLen = dv.getUint16(local + 26, true);
    const lExtraLen = dv.getUint16(local + 28, true);
    const dataAt = local + 30 + lNameLen + lExtraLen;
    out[name] = new TextDecoder().decode(bytes.subarray(dataAt, dataAt + size));
    at += 46 + nameLen + extraLen + dv.getUint16(at + 32, true);
  }
  return out;
}

// 3. Month derivation & file naming checks
eq("2026-08 reports 2026/07", X.cosReportMonth("2026-08"), "2026/07");
eq("January walks back a year", X.cosReportMonth("2026-01"), "2025/12");
eq("the month keeps leading zero", X.cosReportMonth("2026-10"), "2026/09");

// 4. CRC32 standard check
eq("crc32 matches published check value for 123456789", X.crc32(new TextEncoder().encode("123456789")), 0xCBF43926);

// 5. Row mapping from Master Record structure
const masterRecord = {
  IssueBy: "Chan, Tai Man",
  IPTUnitMgr: "Lee, Siu Ming",
  PONo: "PO-123456",
  ContractNo: "L260390185MZ",
  BTBType: "NON-BTB",
  PODate: "2026-08-12",
  ChargeCCC: "CCC01",
  WorksOrderCode: "WO-77",
  AccountCode: "AC-42",
  Vendor: "Nice Systems BV",
  UID: "UID-26-04-0143-10",
  RecordDate: "2026-07-22",
  CustomerName: "NEW CHARM MANAGEMENT LTD",
  SBReportGenerated: "",
  admin_hkdusd: "USD",
  admin_hkd: 125000
};

const HEADERS = X.COS_CONTROL_COLUMNS.map(c => c.header);
const at = (vals, header) => vals[HEADERS.indexOf(header)];
const rowVals = X.cosControlRowValues(masterRecord);

eq("row has 18 values", rowVals.length, 18);
eq("Report Month derived from RecordDate", at(rowVals, "Report Month"), "2026/07");
eq("AO / Input Person Name reads IssueBy", at(rowVals, "AO / Input Person Name"), "Chan, Tai Man");
eq("Unit Manager Name reads IPTUnitMgr", at(rowVals, "Unit Manager Name"), "Lee, Siu Ming");
eq("Issue Type is literal PO", at(rowVals, "Issue Type"), "PO");
eq("PO reads PONo", at(rowVals, "PO"), "PO-123456");
eq("MA No. reads ContractNo", at(rowVals, "MA No."), "L260390185MZ");
eq("COS Details / Description reads BTBType", at(rowVals, "COS Details / Description"), "NON-BTB");
eq("Currency reads admin_hkdusd", at(rowVals, "Currency\n(e.g. HKD,USD)"), "USD");
eq("Currency Amount reads admin_hkd", at(rowVals, "Currency Amount"), "125000");
eq("Vendor Invoice Date is literal NIL", at(rowVals, "Vendor Invoice Date "), "NIL");
eq("Vendor PO Date reads formatted PODate", at(rowVals, "Vendor PO Date"), "12 Aug 2026");
eq("CCC reads ChargeCCC", at(rowVals, "CCC"), "CCC01");
eq("WO# reads WorksOrderCode", at(rowVals, "WO#"), "WO-77");
eq("A/C# reads AccountCode", at(rowVals, "A/C#"), "AC-42");
eq("Vendor Name reads Vendor", at(rowVals, "Vendor Name"), "Nice Systems BV");
eq("UID reads UID", at(rowVals, "UID"), "UID-26-04-0143-10");

// Also test fallback to Currency and PRAmount when admin_hkdusd / admin_hkd are not explicitly set
const fallbackRecord = { ...masterRecord, admin_hkdusd: undefined, admin_hkd: undefined, Currency: "HKD", PRAmount: 99000 };
const fallbackVals = X.cosControlRowValues(fallbackRecord);
eq("Currency falls back to Currency field", at(fallbackVals, "Currency\n(e.g. HKD,USD)"), "HKD");
eq("Currency Amount falls back to PRAmount field", at(fallbackVals, "Currency Amount"), "99000");

// 6. Test filtering records with date period, default selection and generation
const record1Ticked = { ...masterRecord, Title: "REC-1", Id: "REC-1", SBReportGenerated: "2026-10-02" };
const record2Ticked = { ...masterRecord, Title: "REC-2", Id: "REC-2", SBReportGenerated: "2026-10-02" };
const record3Unticked = { ...masterRecord, Title: "REC-3", Id: "REC-3", SBReportGenerated: "" };
const record4Unticked = { ...masterRecord, Title: "REC-4", Id: "REC-4", SBReportGenerated: "" };
const record5Unticked = { ...masterRecord, Title: "REC-5", Id: "REC-5", SBReportGenerated: "" };

ok("record1 is marked as generated", X.isSBReportGenerated(record1Ticked));
ok("record3 is not generated", !X.isSBReportGenerated(record3Unticked));

X.state.allData = [record1Ticked, record2Ticked, record3Unticked, record4Unticked, record5Unticked];
X.state.filteredData = [record1Ticked, record2Ticked, record3Unticked, record4Unticked, record5Unticked];

// Select month matching the records' RecordDate (2026-07-22)
X.handleCosMonthChange("2026-07");
eq("5 records filtered for July 2026", X.cosModalState.filteredRecords.length, 5);
eq("From date set to 2026-07-01", X.cosModalState.fromDate, "2026-07-01");
eq("To date set to 2026-07-31", X.cosModalState.toDate, "2026-07-31");

// By default, only un-generated records are selected
ok("record1 is NOT selected by default", !X.cosModalState.selectedIds.has("REC-1"));
ok("record2 is NOT selected by default", !X.cosModalState.selectedIds.has("REC-2"));
ok("record3 is selected by default", X.cosModalState.selectedIds.has("REC-3"));
ok("record4 is selected by default", X.cosModalState.selectedIds.has("REC-4"));
ok("record5 is selected by default", X.cosModalState.selectedIds.has("REC-5"));

// Generate Excel should generate only the 3 unticked records
X.generateCosControlFile();
eq("downloaded exactly 1 COS control file", downloadedFiles.length, 1);

const today = new Date().toISOString().split("T")[0];
eq("record3Unticked SBReportGenerated updated to today", record3Unticked.SBReportGenerated, today);
eq("record4Unticked SBReportGenerated updated to today", record4Unticked.SBReportGenerated, today);
eq("record5Unticked SBReportGenerated updated to today", record5Unticked.SBReportGenerated, today);
ok("record3Unticked is now marked as generated", X.isSBReportGenerated(record3Unticked));
ok("record4Unticked is now marked as generated", X.isSBReportGenerated(record4Unticked));
ok("record5Unticked is now marked as generated", X.isSBReportGenerated(record5Unticked));
eq("record1Ticked SBReportGenerated unchanged before select all", record1Ticked.SBReportGenerated, "2026-10-02");

// Subsequent generate attempt should find 0 pending records and not download again
X.updateCosControlModalUI();
X.generateCosControlFile();
eq("subsequent generate does not download another file (all marked)", downloadedFiles.length, 1);

// Test Select All control
X.toggleCosSelectAll(true);
ok("Select all selects record1", X.cosModalState.selectedIds.has("REC-1"));
ok("Select all selects record3", X.cosModalState.selectedIds.has("REC-3"));
eq("Select all selects all 5 records", X.cosModalState.selectedIds.size, 5);

// Generating with Select All updates even previously generated records (updates date value)
X.generateCosControlFile();
eq("downloaded another COS control file after select all", downloadedFiles.length, 2);
eq("record1Ticked SBReportGenerated updated to today on generation", record1Ticked.SBReportGenerated, today);

// Test Deselect All
X.toggleCosSelectAll(false);
eq("Deselect all clears selection", X.cosModalState.selectedIds.size, 0);

// Test Select Un-generated only (with a new ungenerated record added)
const record6Unticked = { ...masterRecord, Title: "REC-6", Id: "REC-6", SBReportGenerated: "" };
X.state.allData.push(record6Unticked);
X.updateCosControlModalUI();
X.selectCosUngeneratedOnly();
ok("record6 selected by selectCosUngeneratedOnly", X.cosModalState.selectedIds.has("REC-6"));
ok("record1 NOT selected by selectCosUngeneratedOnly", !X.cosModalState.selectedIds.has("REC-1"));

// Test custom date range change
const fromInput = sandbox.document.getElementById("cos-date-from");
const toInput = sandbox.document.getElementById("cos-date-to");
fromInput.value = "2026-07-01";
toInput.value = "2026-07-15";
X.handleCosDateRangeChange();
eq("0 records match 2026-07-01 to 2026-07-15", X.cosModalState.filteredRecords.length, 0);

toInput.value = "2026-07-31";
X.handleCosDateRangeChange();
eq("6 records match 2026-07-01 to 2026-07-31", X.cosModalState.filteredRecords.length, 6);

// 7. Full OOXML package verification
const pendingOnly = [record3Unticked, record4Unticked, record5Unticked];
const pkgBytes = X.buildCosControlXlsx("2026-10", 0, X.cosControlRowsFrom(pendingOnly));
ok("buildCosControlXlsx returns Uint8Array bytes", pkgBytes instanceof Uint8Array);

const files = unzipStored(pkgBytes);
ok("package has [Content_Types].xml", !!files["[Content_Types].xml"]);
ok("package has _rels/.rels", !!files["_rels/.rels"]);
ok("package has xl/workbook.xml", !!files["xl/workbook.xml"]);
ok("package has xl/styles.xml", !!files["xl/styles.xml"]);
ok("package has xl/worksheets/sheet1.xml", !!files["xl/worksheets/sheet1.xml"]);

const sheetXml = files["xl/worksheets/sheet1.xml"];
ok("sheet has AutoFilter over 3 data rows (A1:R4)", sheetXml.includes('<autoFilter ref="A1:R4"/>'));
ok("column A carries Report Month 2026/07", sheetXml.includes('<c r="A2" s="19" t="inlineStr"><is><t>2026/07</t></is></c>'));
ok("data row carries Vendor Name", sheetXml.includes("Nice Systems BV"));

// 8. Test Dataverse persistence when Generate is clicked
(async () => {
  const updatedRecords = [];
  const mockWebApi = {
    retrieveMultipleRecords: async (entity, query) => ({
      entities: [{ admin_btb_lis_excel_datasid: "guid-dv-101", admin_title: "REC-DV-1" }]
    }),
    updateRecord: async (entity, id, payload) => {
      updatedRecords.push({ entity, id, payload });
      return { id };
    }
  };

  sandbox.parent = { Xrm: { WebApi: mockWebApi } };

  const recordDv1 = { ...masterRecord, Title: "REC-DV-1", Id: "REC-DV-1", SBReportGenerated: "" };
  const recordDv2 = { ...masterRecord, Title: "REC-DV-2", Id: "REC-DV-2", dataverseId: "guid-dv-102", SBReportGenerated: "" };
  X.state.allData = [recordDv1, recordDv2];
  X.cosModalState.filteredRecords = [recordDv1, recordDv2];
  X.cosModalState.selectedIds = new Set(["REC-DV-1", "REC-DV-2"]);

  const savePromise = X.generateCosControlFile();
  if (savePromise) await savePromise;

  ok("Dataverse updateRecord was called for generated records", updatedRecords.length === 2);
  const update1 = updatedRecords.find(u => u.id === "guid-dv-101");
  const update2 = updatedRecords.find(u => u.id === "guid-dv-102");
  ok("recordDv1 was updated via queried GUID", !!update1);
  ok("recordDv2 was updated via known dataverseId", !!update2);
  eq("entity is admin_btb_lis_excel_datas", update1 && update1.entity, "admin_btb_lis_excel_datas");
  eq("column admin_sbreportgenrated has date value", update1 && update1.payload && update1.payload.admin_sbreportgenrated, today + "T00:00:00Z");
  eq("column admin_sbreportgenrated on recordDv2 has date value", update2 && update2.payload && update2.payload.admin_sbreportgenrated, today + "T00:00:00Z");

  if (failures > 0) {
    console.error(`\nFAILED: ${failures} assertions failed.`);
    process.exit(1);
  } else {
    console.log("\nALL CHECKS PASSED: Master page_21-Sep-2026.html updated COS Control File verified successfully.");
  }
})();
