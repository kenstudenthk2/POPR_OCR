/* cos-control-file.test.js -- the monthly COS control file
   ---------------------------------------------------------
   Master Records' "COS Control File" button hands the reviewer an EMPTY copy of
   procurement's own monthly workbook. "Empty" is the easy half; the half worth
   pinning is that it comes out formatted exactly like the original, because a
   file whose eighteen headers are the wrong colour costs the reviewer the very
   re-formatting the button exists to remove -- and on screen a nearly-right
   orange is indistinguishable from a right one.

   So this test does not stop at "a function returned something". It UNZIPS the
   bytes the button would download and reads the OOXML back out, then checks
   every header against a transcription of `202608 COS control file_V0 1.xlsx`
   taken off that workbook's own sheet1.xml and styles.xml. The reference file
   is procurement's and is not in the repo, which is exactly why the
   transcription is here rather than a read of the file: a check that needs a
   document nobody has is a check that gets deleted.

   The other thing pinned here is the one asymmetry a reviewer is most likely to
   report as a bug: picking 2026/08 produces a file NAMED 202608 whose every row
   says 2026/07. The August file reports July. `cosReportMonth` walks the month
   back and `cosControlFileName` deliberately does not go through it.

   Run: node _test/app-harness/cos-control-file.test.js
*/
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const Babel = require("@babel/standalone");
const React = require("react");

const REPO = path.resolve(__dirname, "..", "..");
const HTML_PATH = process.argv[2] || path.join(REPO, "PR Assistant App.html");
const HTML = fs.readFileSync(HTML_PATH, "utf8");

const m = HTML.match(/<script type="text\/babel-jsx" id="app-src">([\s\S]*?)<\/script>/);
if (!m) { console.error("FAIL: could not find the app-src block in " + HTML_PATH); process.exit(1); }
let src = m[1].replace(/ReactDOM\.createRoot\([\s\S]*$/, "");

let code;
try {
  code = Babel.transform(src, { presets: [["react", { runtime: "classic" }]] }).code;
} catch (e) {
  console.error("FAIL: Babel could not compile the JSX block:\n" + e.message);
  process.exit(1);
}

const store = {};
const sandbox = {
  React,
  ReactDOM: { createRoot: () => ({ render() {} }) },
  console,
  XLSX: undefined,
  setTimeout, clearTimeout,
  // The builder is pure over these two -- no Blob, no anchor, no download. That
  // separation is the reason this file can check the BYTES at all.
  TextEncoder, Uint8Array,
  window: {
    localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } },
    addEventListener() {}, removeEventListener() {}, confirm: () => true, alert() {},
  },
  document: { getElementById: () => ({ textContent: "" }) },
  parent: {},
  URL: { createObjectURL: () => "blob:x" },
  URLSearchParams,
  EXPORTS: {},
};
sandbox.globalThis = sandbox;

const NAMES = ["COS_CONTROL_COLUMNS", "COS_CONTROL_DEFAULT_ROWS", "COS_CONTROL_MAX_ROWS",
  "cosReportMonth", "cosControlFileName", "buildCosControlXlsx", "buildCosSheetXml",
  "buildCosStylesXml", "zipStore", "crc32", "colLetter", "FEATURES", "IS_ADMIN",
  "cosCellText", "cosControlRowValues", "cosControlRowsFrom",
  "cosControlRowsFor", "cosRecdMonth"];
code += "\n;" + NAMES.map(n => `try { EXPORTS.${n} = ${n}; } catch (e) {}`).join("\n");

try {
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: "app-src.js" });
} catch (e) {
  console.error("FAIL: module body threw at load time:\n" + e.stack);
  process.exit(1);
}
console.log("OK   module body evaluated");

const X = sandbox.EXPORTS;
let failures = 0;
const eq = (label, actual, expected) => {
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  if (a === b) { console.log("OK   " + label); return; }
  failures++;
  console.error("FAIL " + label + "\n     expected " + b + "\n     actual   " + a);
};
const ok = (label, cond) => eq(label, !!cond, true);

/* ---------- 1. Report Month is the month BEFORE the file's own name ---------- */

eq("2026-08 reports 2026/07", X.cosReportMonth("2026-08"), "2026/07");
eq("January walks back a year", X.cosReportMonth("2026-01"), "2025/12");
eq("the month keeps its leading zero", X.cosReportMonth("2026-10"), "2026/09");
// Not "NaN/NaN" down twenty rows: a blank picker writes no month at all, and
// the dialog's Generate button is disabled on exactly this answer.
eq("a blank picker reports nothing", X.cosReportMonth(""), "");
eq("a month of 13 reports nothing", X.cosReportMonth("2026-13"), "");

// The file name does NOT go through cosReportMonth. Picking August has to give
// the 202608 file -- naming it 202607 would file August's report under July.
eq("the file is named for the month PICKED",
  X.cosControlFileName("2026-08"), "202608 COS control file_V0 1.xlsx");
eq("January's file is named for January, not for December",
  X.cosControlFileName("2026-01"), "202601 COS control file_V0 1.xlsx");

/* ---------- 2. the workbook, unzipped ---------- */

// A reader for the stored (uncompressed) zip zipStore writes. Deliberately not
// a library: reading the bytes back with the same assumptions the writer made
// would prove nothing, so this walks the central directory the way any unzip
// does and would notice a wrong offset, a wrong length or a wrong name.
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
    const commentLen = dv.getUint16(at + 32, true);
    const local = dv.getUint32(at + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLen));
    if (dv.getUint32(local, true) !== 0x04034b50) throw new Error("bad local header for " + name);
    const lNameLen = dv.getUint16(local + 26, true);
    const lExtraLen = dv.getUint16(local + 28, true);
    const dataAt = local + 30 + lNameLen + lExtraLen;
    out[name] = new TextDecoder().decode(bytes.subarray(dataAt, dataAt + size));
    at += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

const bytes = X.buildCosControlXlsx("2026-08", 20);
ok("the builder returns bytes", bytes && bytes.length > 0);

let parts;
try { parts = unzipStored(bytes); }
catch (e) { console.error("FAIL the produced file is not a readable zip: " + e.message); process.exit(1); }

// Every part Excel needs. A missing one does not fail loudly in the browser --
// Excel offers to repair the file, which a reviewer reads as "this app is broken".
["[Content_Types].xml", "_rels/.rels", "xl/workbook.xml", "xl/_rels/workbook.xml.rels",
 "xl/styles.xml", "xl/worksheets/sheet1.xml"].forEach(name => {
  ok("the package carries " + name, typeof parts[name] === "string" && parts[name].length > 0);
});
eq("the package carries nothing else", Object.keys(parts).length, 6);
ok("every part is well-formed XML at the declaration", Object.keys(parts)
  .every(k => parts[k].startsWith('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>')));

/* ---------- 3. the headers, against the real workbook ---------- */

// Transcribed from `202608 COS control file_V0 1.xlsx`: sheet1.xml's row 1 for
// the text and the <cols> widths, styles.xml's fills for the colours. The
// trailing space on "Vendor Invoice Date " and the newline inside the Currency
// header are both in the original and both deliberate here.
const REFERENCE = [
  ["A", "Report Month", null, 11.42578125],
  ["B", "AO / Input Person Name", "FF0000", 20.42578125],
  ["C", "Unit Manager Name", "EE0000", 43.28515625],
  ["D", "Engineering Team", "92D050", 17.85546875],
  ["E", "Product Line", "92D050", 14.7109375],
  ["F", "Issue Type", "FF0000", 8.5703125],
  ["G", "PO", "FF0000", 13],
  ["H", "MA No.", "00B0F0", 29],
  ["I", "COS Details / Description", "00B0F0", 14.42578125],
  ["J", "Currency\n(e.g. HKD,USD)", "FFFF00", 19],
  ["K", "Currency Amount", "FFFF00", 13.28515625],
  ["L", "Vendor Invoice Date ", "FFC000", 19.140625],
  ["M", "Vendor PO Date", "FFC000", 19.85546875],
  ["N", "CCC", "92D050", 7.140625],
  ["O", "WO#", "92D050", 12.7109375],
  ["P", "A/C#", "92D050", 12.85546875],
  ["Q", "Vendor Name", "FF0000", 53.5703125],
  ["R", "UID", "00B0F0", 34.140625],
];

eq("eighteen columns, A to R", X.COS_CONTROL_COLUMNS.length, REFERENCE.length);
eq("the headers read as the real file prints them",
  X.COS_CONTROL_COLUMNS.map(c => c.header), REFERENCE.map(r => r[1]));
eq("the widths are the real file's", X.COS_CONTROL_COLUMNS.map(c => c.width), REFERENCE.map(r => r[3]));

const sheet = parts["xl/worksheets/sheet1.xml"];
const styles = parts["xl/styles.xml"];

// Header cells, read back out of the sheet the way Excel would: cell -> style
// index -> xf -> fill -> rgb. A test that read COS_CONTROL_COLUMNS instead
// would pass however the XML was actually written.
const cellXfs = (styles.match(/<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/) || [, ""])[1]
  .match(/<xf [^>]*\/>|<xf [^>]*>[\s\S]*?<\/xf>/g) || [];
const fills = (styles.match(/<fills[^>]*>([\s\S]*?)<\/fills>/) || [, ""])[1]
  .match(/<fill>[\s\S]*?<\/fill>/g) || [];
const fillRgbOf = (xfIdx) => {
  const fillId = Number((cellXfs[xfIdx].match(/fillId="(\d+)"/) || [, -1])[1]);
  const rgb = (fills[fillId] || "").match(/fgColor rgb="FF([0-9A-F]{6})"/);
  return rgb ? rgb[1] : null;
};
const headerCell = (ref) => {
  const re = new RegExp('<c r="' + ref + '" s="(\\d+)" t="inlineStr"><is><t[^>]*>([\\s\\S]*?)<\\/t>');
  const hit = sheet.match(re);
  if (!hit) return null;
  const text = hit[2].replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'");
  return { style: Number(hit[1]), text: text };
};

REFERENCE.forEach(([col, header, fill]) => {
  const cell = headerCell(col + "1");
  if (!cell) { failures++; console.error("FAIL header " + col + "1 is not in the sheet"); return; }
  eq("header " + col + "1 reads " + JSON.stringify(header), cell.text, header);
  eq("header " + col + "1 is filled " + (fill || "(none)"), fillRgbOf(cell.style), fill);
});

// Fills 0 and 1 are reserved by the format. Excel offers to repair a workbook
// that drops them even though nothing in this sheet uses either.
ok("fill 0 is none and fill 1 is gray125",
  /patternType="none"/.test(fills[0] || "") && /patternType="gray125"/.test(fills[1] || ""));

// Every header cell: bold Arial, centred both ways, wrapped, four thin borders.
// Read off one representative rather than all eighteen -- they share one xf
// shape, and the fill check above is what separates them.
const b1 = headerCell("B1");
ok("headers are bold", /fontId="2"/.test(cellXfs[b1.style]));
ok("headers are centred and wrapped",
  /horizontal="center"/.test(cellXfs[b1.style]) && /vertical="center"/.test(cellXfs[b1.style])
  && /wrapText="1"/.test(cellXfs[b1.style]));
ok("headers are bordered", /borderId="1"/.test(cellXfs[b1.style]));
ok("the bold font is Arial", /<font><b\/><sz val="11"\/><name val="Arial"\/>/.test(styles));
ok("border 1 is thin on all four sides",
  (styles.match(/<border><left style="thin">[\s\S]*?<\/border>/) || [""])[0].split('style="thin"').length === 5);
ok("row 1 is 60pt tall", /<row r="1"[^>]*ht="60" customHeight="1"/.test(sheet));
ok("the sheet carries the AutoFilter", /<autoFilter ref="A1:R21"\/>/.test(sheet));
ok("the sheet is named for the year the rows REPORT",
  /<sheet name="2026" sheetId="1"/.test(parts["xl/workbook.xml"]));
// A January pick reports the previous December, so the tab is the year before
// the one in the file's own name.
ok("a January file's sheet is the previous year",
  /<sheet name="2025" sheetId="1"/.test(unzipStored(X.buildCosControlXlsx("2026-01", 1))["xl/workbook.xml"]));

/* ---------- 4. the blank rows, and the one column that is not blank ---------- */

const rows = sheet.match(/<row r="\d+"[\s\S]*?<\/row>/g) || [];
eq("one header row plus the twenty asked for", rows.length, 21);

const dataRow = rows[1];
eq("every column gets a cell, blank or not", (dataRow.match(/<c r="/g) || []).length, 18);
ok("column A carries the Report Month", /<c r="A2" s="\d+" t="inlineStr"><is><t>2026\/07<\/t>/.test(dataRow));
// Text, not a date. The real file's A cells are shared strings reading
// "2026/07"; a date here would render as 7/1/2026 in the reviewer's own locale.
ok("column A is TEXT", /<c r="A2"[^>]*t="inlineStr"/.test(dataRow));
// Empty but STYLED. A genuinely absent cell loses its border and its number
// format the moment somebody types in it, which is the whole point of handing
// over a grid rather than a header row.
ok("B2 is empty and still styled", /<c r="B2" s="\d+"\/>/.test(dataRow));
ok("the last column of the last row is there", /<c r="R21" s="\d+"\/>/.test(rows[20]));

const dataBase = 1 + REFERENCE.length;
ok("every blank cell is bordered",
  X.COS_CONTROL_COLUMNS.every((c, i) => /borderId="1"/.test(cellXfs[dataBase + i])));
ok("Currency Amount keeps its 2-decimal format", /numFmtId="4"/.test(cellXfs[dataBase + 10]));
ok("the two date columns keep a date format",
  /numFmtId="15"/.test(cellXfs[dataBase + 11]) && /numFmtId="15"/.test(cellXfs[dataBase + 12]));

// The row count is clamped, not trusted. The dialog's number input is the only
// caller, and a reviewer who types 99999 into it should get a large file rather
// than a browser that stops responding.
eq("a silly row count is clamped",
  ((unzipStored(X.buildCosControlXlsx("2026-08", 99999))["xl/worksheets/sheet1.xml"])
    .match(/<row r="\d+"/g) || []).length, X.COS_CONTROL_MAX_ROWS + 1);
eq("a row count of nothing gives the header alone",
  ((unzipStored(X.buildCosControlXlsx("2026-08", 0))["xl/worksheets/sheet1.xml"])
    .match(/<row r="\d+"/g) || []).length, 1);

/* ---------- 4b. the Master Records rows the file is generated from ----------

   Every `source` below is a key on the row objects the Master Records fetch
   builds, not a Dataverse column name -- that transcription lives in
   DATAVERSE_SCHEMAS and this feature deliberately adds none of its own. What
   is worth pinning here is the three things that are NOT a plain copy: the two
   literals the form always carries, the four columns with no source at all,
   and the em dash the fetch writes for an empty column. */

const EM = String.fromCharCode(8212);
const SAMPLE_ROW = {
  issueBy: "Chan, Tai Man", iptUnitMgr: "Lee, Siu Ming", poNo: "PO-123456",
  contractNo: "L260390185MZ", btbType: "NON-BTB", poDate: "12 Aug 2026",
  chargeCcc: "CCC01", worksOrderCode: "WO-77", accountCode: "AC-42",
  vendor: "Nice Systems BV", uid: "UID-26-04-0143-10",
  // Not a COS column; here so a stray key cannot leak into the row.
  customerName: "NEW CHARM MANAGEMENT LTD",
};

const HEADERS = X.COS_CONTROL_COLUMNS.map(c => c.header);
const at = (values, header) => values[HEADERS.indexOf(header)];
const vals = X.cosControlRowValues(SAMPLE_ROW);

eq("a row has one value per column", vals.length, X.COS_CONTROL_COLUMNS.length);
eq("Report Month is left to buildCosSheetXml", at(vals, "Report Month"), "");
eq("AO / Input Person Name reads Issue By", at(vals, "AO / Input Person Name"), "Chan, Tai Man");
eq("Unit Manager Name reads IPT Unit Mgr", at(vals, "Unit Manager Name"), "Lee, Siu Ming");
eq("Issue Type is the literal PO", at(vals, "Issue Type"), "PO");
eq("PO reads PO No.", at(vals, "PO"), "PO-123456");
eq("MA No. reads Contract No.", at(vals, "MA No."), "L260390185MZ");
eq("COS Details / Description reads BTB Type", at(vals, "COS Details / Description"), "NON-BTB");
eq("Vendor Invoice Date is the literal NIL", at(vals, "Vendor Invoice Date "), "NIL");
eq("Vendor PO Date reads PO Date", at(vals, "Vendor PO Date"), "12 Aug 2026");
eq("CCC reads Charge CCC", at(vals, "CCC"), "CCC01");
eq("WO# reads Works Order Code", at(vals, "WO#"), "WO-77");
eq("A/C# reads Account Code", at(vals, "A/C#"), "AC-42");
eq("Vendor Name reads Vendor", at(vals, "Vendor Name"), "Nice Systems BV");
eq("UID reads UID #", at(vals, "UID"), "UID-26-04-0143-10");

// The four nobody has named a source for. Blank, not guessed -- a wrong value
// here reads as an answered cell in a workbook procurement then works from.
["Engineering Team", "Product Line", "Currency" + String.fromCharCode(10) + "(e.g. HKD,USD)", "Currency Amount"]
  .forEach(h => eq("`" + h.split(String.fromCharCode(10)).join(" ") + "` is left blank", at(vals, h), ""));

// The fetch's own placeholder for an empty column. Written through, it would
// put an em dash in every unfilled cell.
eq("an em dash becomes a blank cell", X.cosCellText(EM), "");
eq("a lone hyphen becomes a blank cell too", X.cosCellText("-"), "");
eq("a real value is untouched", X.cosCellText("  PO-1  "), "PO-1");
eq("a placeholder row still carries its literals",
  at(X.cosControlRowValues({ poNo: EM, vendor: EM }), "Issue Type"), "PO");
eq("a placeholder row blanks its sourced cells",
  at(X.cosControlRowValues({ poNo: EM, vendor: EM }), "PO"), "");

eq("no records give no rows", X.cosControlRowsFrom([]).length, 0);
eq("two records give two rows", X.cosControlRowsFrom([SAMPLE_ROW, SAMPLE_ROW]).length, 2);

/* The data rows land in the sheet, above the blank ones, and every row carries
   the Report Month in column A. */
const withRows = unzipStored(X.buildCosControlXlsx("2026-08", 2, X.cosControlRowsFrom([SAMPLE_ROW])))["xl/worksheets/sheet1.xml"];
eq("one data row plus two blank rows plus the header",
  (withRows.match(/<row r="\d+"/g) || []).length, 4);
ok("the data row carries its Vendor Name", /<c r="Q2"[^>]*><is><t[^>]*>Nice Systems BV</.test(withRows));
ok("the data row's column A is still the Report Month", /<c r="A2"[^>]*><is><t[^>]*>2026\/07</.test(withRows));
ok("a blank row below it still gets the Report Month", /<c r="A3"[^>]*><is><t[^>]*>2026\/07</.test(withRows));
ok("the blank row's Vendor Name cell is empty but still styled", /<c r="Q3" s="\d+"\/>/.test(withRows));
ok("the AutoFilter covers the data rows", /<autoFilter ref="A1:R4"\/>/.test(withRows));

/* ⚠️ The whole guarantee of the `rows` parameter: a call that does not pass it
   writes exactly the sheet it always did. Every assertion above section 4b is
   a two-argument call, and this says so in one line. */
eq("without `rows` the sheet is byte-identical to the old one",
  X.buildCosSheetXml("2026/07", 5, X.COS_CONTROL_COLUMNS),
  X.buildCosSheetXml("2026/07", 5, X.COS_CONTROL_COLUMNS, []));
eq("the default extra-blank-row count is now zero", X.COS_CONTROL_DEFAULT_ROWS, 0);

/* ---------- 4c. the Report Month narrows the rows ----------

   Column A says 2026/07 on every row of the file, so the rows under it have to
   BE July's. What decides that is Rec'd Date -- admin_recx0027dx0020datex0020,
   already in the row as the fetch formatted it. */

eq("the display spelling reads as its month", X.cosRecdMonth("22 Jul 2026"), "2026/07");
eq("a single-digit month keeps its leading zero", X.cosRecdMonth("3 Jan 2026"), "2026/01");
eq("an ISO day reads as its month too", X.cosRecdMonth("2026-07-01"), "2026/07");
// Read as text, not through Date(). A bare ISO day is UTC midnight, so at a
// negative offset new Date("2026-07-01").getMonth() is June -- a record filed
// into the month before the one it was received in, silently.
eq("the 1st of a month stays in that month", X.cosRecdMonth("2026-07-01"), "2026/07");
eq("the last day of a month stays in it", X.cosRecdMonth("2026-07-31"), "2026/07");
eq("the fetch's em dash belongs to no month", X.cosRecdMonth(EM), "");
eq("a blank belongs to no month", X.cosRecdMonth(""), "");
eq("so does something unreadable", X.cosRecdMonth("TBC"), "");
eq("and so does nothing at all", X.cosRecdMonth(null), "");

const JUL = { ...SAMPLE_ROW, recdDate: "22 Jul 2026", vendor: "July Vendor" };
const AUG = { ...SAMPLE_ROW, recdDate: "02 Aug 2026", vendor: "August Vendor" };
const NONE = { ...SAMPLE_ROW, recdDate: EM, vendor: "Undated Vendor" };

eq("only the Report Month's rows are kept",
  X.cosControlRowsFor([JUL, AUG, NONE], "2026/07").length, 1);
eq("...and it is the right one",
  at(X.cosControlRowsFor([JUL, AUG, NONE], "2026/07")[0], "Vendor Name"), "July Vendor");
eq("a different month keeps the other row",
  at(X.cosControlRowsFor([JUL, AUG, NONE], "2026/08")[0], "Vendor Name"), "August Vendor");
eq("a record with no Rec'd Date is in no month's file",
  X.cosControlRowsFor([NONE], "2026/07").length, 0);
// Not "everything": the Generate button is disabled without a month, so a
// count of every row on the page would be one the button could never produce.
eq("no month narrows to nothing", X.cosControlRowsFor([JUL, AUG], "").length, 0);
eq("no records is still no rows", X.cosControlRowsFor([], "2026/07").length, 0);

// The month the FILE is named for is not the month it reports -- picking
// 2026-08 keeps July's records. The one place that says so is cosReportMonth,
// and this is what makes the two halves agree end to end.
eq("picking August keeps July's records",
  X.cosControlRowsFor([JUL, AUG], X.cosReportMonth("2026-08")).length, 1);

/* ---------- 5. the zip itself ---------- */

// The one value a zip needs that JS has no builtin for, against the published
// check value for "123456789".
eq("crc32 matches the standard check value",
  X.crc32(new TextEncoder().encode("123456789")), 0xCBF43926);

/* ---------- 6. dev only, and switched off the way every other one-side
   feature is -- through FEATURES, not a bare IS_ADMIN branch ---------- */

eq("the feature follows the side", X.FEATURES.cosControlFile, !X.IS_ADMIN);
ok("the button is behind the flag", /FEATURES\.cosControlFile &&[\s\S]{0,200}COS Control File/.test(HTML));
ok("the dialog is behind the flag too", /cosOpen && FEATURES\.cosControlFile/.test(HTML));

console.log(failures ? "\n" + failures + " FAILURE(S)" : "\nall good");
process.exit(failures ? 1 : 0);
