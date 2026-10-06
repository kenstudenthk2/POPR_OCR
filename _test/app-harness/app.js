// Rung-0 harness for `PR Assistant App.html` (no browser, no OCR, no React DOM).
//
// The App's logic lives in one <script type="text/babel-jsx" id="app-src"> block.
// Everything in it is a plain top-level declaration in one flat scope, so once the
// JSX is compiled away the block runs perfectly well under Node -- which makes the
// pure functions (classification, diffing, cross-checking, field mapping) callable
// against the DEMO_ATTACHMENTS fixture already in the file.
//
// Same shape as _test/_test/harness/engine.js: read the source as text, splice one
// export assignment in, run it in a `vm`. The App needs two extra steps the engine
// does not:
//
//   1. The render call at the very bottom is dropped. It is the block's only
//      top-level side effect and the only line that needs a real DOM.
//   2. Top-level `const` in a `vm` script never lands on the sandbox global -- only
//      function declarations do. DEMO_ATTACHMENTS, DOC_ROLES, DIFF_KEYS and friends
//      are all `const`, so they are handed out explicitly.
//
// The export list is resilient by design: a name that does not exist yet comes back
// undefined instead of throwing, so this file keeps working while the functions it
// names are still being written.

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const Babel = require('@babel/standalone');

const APP_PATH = path.join(__dirname, '..', '..', 'PR Assistant App.html');

// Handed out on `globalThis.__app`. Functions are here for convenience only --
// they would land on the global anyway; the `const`s are the ones that must be.
const EXPORTS = [
  // the monthly COS control file (Master Records, dev side)
  'COS_CONTROL_COLUMNS', 'COS_CONTROL_DEFAULT_ROWS', 'COS_CONTROL_MAX_ROWS',
  'cosCellText', 'cosControlRowValues', 'cosControlRowsFrom', 'cosControlRowsFor', 'cosRecdMonth',
  'cosReportMonth', 'cosControlFileName', 'buildCosStylesXml', 'buildCosSheetXml',
  'buildCosControlXlsx', 'zipStore', 'crc32', 'colLetter',
  // fixtures
  'DEMO_ATTACHMENTS', 'EMPTY_ATTACHMENTS', 'ATTACHMENT_TYPES',
  // field vocabulary
  'FIELD_DEFS', 'FIELD_LABELS', 'FIELD_LABEL_MAP', 'FIELD_LABEL_FALLBACKS',
  'DIFF_KEYS', 'COMPARE_ONLY_FIELDS', 'COMPARE_ONLY_LABELS',
  'quotationRefFromText', 'vendorFromText', 'looksLikeCompanyName',
  'splitPeriodRange', 'PERIOD_LABEL_PATTERN', 'HEADER_CELL_VALUE',
  'contractNoFromText', 'hkdTotalFromText', 'vendorsAgree',
  'normQuotationFile', 'recordsBearingTypeKey', 'offItemQuotationTest',
  'FUZZY_DIFF_KEYS', 'DIFF_JACCARD_MIN', 'DIFF_MIN_CHARS', 'DIFF_MIN_CHARS_BY_KEY',
  'OUR_COMPANY', 'OUR_CORE_NAMES',
  // the email subject read as a record of its own
  'extractUid', 'UID_PATTERN', 'subjectLineOf', 'trailingItemVendor',
  'subjectCustomer', 'parseEmailSubject', 'emailSubjectOf', 'uidFromEmail',
  'emailBodyTextOf', 'uidFromEmailBody',
  'printedItemList', 'subjectTypeBlock', 'planSavesForItem', 'savedRecordIdOf', 'itemProcessOptions',
  'isRecordMatchItem', 'currentAtqNoOf',
  // normalisers
  'normAmount', 'normDate', 'normName', 'normRef', 'normText',
  'tokenJaccard', 'listParts', 'listCoversRest', 'ourCompanyOnlyDissent', 'isOurCompanyName',
  // whose chop / whose signature (engine markContext -> App)
  'markOwnerName', 'markIsOurs', 'otherPartyMarks', 'otherPartyNames',
  'signingPills', 'markDetections',
  // diffing
  'computeFieldDiffs', 'activeDiffList', 'dismissedDiffList', 'dissentingSource',
  'diffDocIndexes', 'diffsForDoc', 'mapDetectedFields',
  'itemNoOf', 'anchorRecordsOf', 'anchoredRecordOf', 'recordIdFor', 'assignRecordIds',
  'recordsBearingEntry', 'fallbackBaseFor', 'buildRecordPayload', 'buildAtqExcelPayload', 'writeAtqExcelRecord',
  'buildLisExcelPayload', 'writeLisExcelRecord', 'parseDecimal', 'parseIsoDate',
  'LIS_ROW_TO_FIELD_KEY', 'seedFieldsFromLisRows',
  // The Verify Table's row list, unfiltered and filtered -- the pair is what
  // lets side-schema.test.js pin that a devOnly row is dropped on Admin
  // without a second filter anywhere else. See FEATURES.verifyLisCodes.
  'VERIFY_TABLE_ROWS_ALL', 'VERIFY_TABLE_ROWS',
  // The Product Type -> coding lookup behind the Verify Table's "Pair" button.
  // Both are pure, which is the whole reason they are top-level functions
  // rather than closures inside ExtractedFieldsPage -- the harness has no
  // Dataverse, so the fetch half cannot be tested and the matching half is
  // exactly where the rules live. See FEATURES.verifyCodePair.
  'normCodeKey', 'pairCodesFromLookup',
  // roles
  'DOC_ROLES', 'ROLE_MATCH_ORDER', 'ROLE_DETECT_ORDER', 'REFERENCE_ORDER',
  'PROMOTED_BY_SIGNING', 'ROLE_CHIP_STYLES', 'ROLE_SLOT_STYLES',
  'docHeadingLines', 'headingRoleOf', 'namedRoleOfSource', 'autoRoleOfSource',
  'roleOfSource', 'docKeyOf', 'pdfFirst', 'sourceBaseName', 'isSignedDoc', 'roleCensus',
  // extracted-fields preview (Process -> Verify)
  'EXTRACTED_FIELD_COLUMNS', 'EXTRACTED_FIELD_ROWS', 'SPANNING_ROWS', 'FIELD_ROW_CONFIG', 'recordIdForItem',
  'EXTRACTED_EMAIL_COLUMN', 'SUBJECT_ROW_READERS', 'subjectVerdict', 'itemIndexForSubject',
  'signatureDetectionLabel', 'roleCellValue', 'ExtractedFieldsPage', 'AnimatedSelect',
  'columnDocSource',
  // printing the open document
  'previewKindForExt', 'VIEWER_SHEET_EXTS', 'VIEWER_TEXT_EXTS', 'DROP_PARSABLE_EXTS', 'ACCEPT_EXTS',
  'textLinesFor', 'PreviewPane',
  'printableFor', 'printSheetHtml', 'escapeForPrint', 'ViewerHeader',
  'CROSS_CHECK_SOURCES', 'crossCheckSourceOf', 'CHOP_LIS_ROW',
  'DATAVERSE_VERIFY_SOURCES', 'DATAVERSE_LIS_SOURCE', 'DATAVERSE_ATQ_EXCEL_SOURCE', 'dataverseVerifyQuery', 'dataverseVerifyRecord', 'verifyCellValue',
  // one file, two web resources -- which side this copy is running as
  'SIDE_BY_RESOURCE', 'resolveSide', 'SIDE', 'IS_ADMIN', 'SIDE_READY', 'SIDE_LABEL',
  // the two remark sentences, and the month count the dev Period line prints
  'buildToSupplierRemark', 'monthsBetween', 'interpolateRemark',
  'fetchSupplierRemarkRows', 'DEMO_SUPPLIER_REMARKS', 'getRowCcc', 'getRowRemark',
  'buildBtbRemark', 'BTB_ADMIN_NAMES', 'BTB_ADMINS', 'adminIssuedBy', 'BTB_SALES_CONTACTS',
  'FEATURES', 'DATAVERSE_SCHEMAS', 'SCHEMA', 'mapPayload', 'buildLisStartPayload', 'btbTypeOf',
  'localIsoDay', 'localIsoTomorrow',
  'NAV_ITEMS_ALL', 'NAV_ITEMS', 'navReachable',
  'findExistingLisRecordId',
  'dataverseIsActive', 'dataverseCellValue', 'lisCellValue', 'atqExcelCellValue', 'dataverseVerifyNotice', 'verifyValueTone',
  // dropped files (Outlook virtual-file path)
  'collectDroppedFiles', 'readEntryAsFile', 'nameForParsing',
  // handing the role-assigned documents to n8n
  'N8N_WEBHOOK_URL', 'roleDocumentsForSend', 'n8nMetadataForSend', 'atqCostFieldForItem', 'atqWorkbookField', 'docAt', 'selfDocFor', 'extraQuotationDocs',
  // cross-checking
  'computeCrosschecks', 'crosscheckField', 'pairSeverity', 'worstSeverity',
  'fieldCrossCheck', 'crosscheckSentence', 'crosscheckDissent', 'crosscheckDocKeys',
  'crosscheckSources', 'activeCrosscheckList', 'dismissedCrosscheckList',
  'crosscheckDocIndexes', 'crosschecksForDoc', 'AUTO_CHECK_GROUPS',
  'supersededRevisionOf',
  // components -- only reachable with the real React, but harmless to list
  'App', 'UploadPage', 'ProcessingPage', 'VerifyPage', 'DocumentViewer', 'RoleSlotBar',
  'RoleAssignmentEditor', 'FieldCrossCheck', 'FieldComparePanel', 'InfoPane',
  'renderFieldInput', 'initialFormState', 'DEMO_RECORDS', 'EMPTY_RECORDS',
  'LisRemarkPage', 'EXCEL_COLUMN_MAP',
];

// The block, minus the one line that needs a browser.
function appSource() {
  const html = fs.readFileSync(APP_PATH, 'utf8');
  const open = html.indexOf('<script type="text/babel-jsx" id="app-src">');
  if (open < 0) throw new Error('app-src block not found -- has the script tag been renamed?');
  const start = html.indexOf('>', open) + 1;
  const end = html.indexOf('</script>', start);
  if (end < 0) throw new Error('app-src block is not closed');
  const src = html.slice(start, end);
  // Its only top-level side effect, and the only line here that needs a real DOM.
  const stripped = src.replace(/ReactDOM\.createRoot\([\s\S]*?\)\.render\(<App \/>\);?/, '');
  if (stripped === src) throw new Error('render call not found -- the harness would try to mount');
  return stripped + '\n' + exportTail();
}

function exportTail() {
  const entries = EXPORTS
    .map(n => `  ${JSON.stringify(n)}: (typeof ${n} !== "undefined" ? ${n} : undefined),`)
    .join('\n');
  return `globalThis.__app = {\n${entries}\n};\n`;
}

// Enough React for the pure functions to be reachable. useMemo runs its factory so
// a memo reads like the plain call it wraps; useState hands back the initial value
// and a setter that does nothing, because nothing here re-renders.
function reactStub() {
  const noop = () => {};
  return {
    useState: v => [typeof v === 'function' ? v() : v, noop],
    useMemo: f => f(),
    useEffect: noop,
    useRef: v => ({ current: v === undefined ? null : v }),
    useCallback: f => f,
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    Fragment: 'Fragment',
    createContext: () => ({ Provider: 'Provider', Consumer: 'Consumer' }),
  };
}

const cached = {};

// Returns the App's top-level declarations.
//
// `react` swaps the stub for the real thing, which is what lets the components
// be server-rendered: the stub is enough to reach the pure functions but a
// no-op useState cannot render a tree. Both are cached separately -- compiling
// the block is the slow part and it holds no state worth resetting.
function load(opts) {
  const real = !!(opts && opts.react);
  const slot = real ? 'react' : 'stub';
  if (cached[slot]) return cached[slot];
  const code = Babel.transform(appSource(), {
    presets: [['react', { runtime: 'classic' }]],
  }).code;

  const sandbox = {
    React: real ? require('react') : reactStub(),
    ReactDOM: { createRoot: () => ({ render: () => {} }) },
    console,
    setTimeout, clearTimeout, setInterval, clearInterval,
    // The App reaches for these at call time, never at load time, so bare stubs
    // are enough to get the block through.
    window: {}, navigator: {}, localStorage: null,
    // A vm context gets the JS builtins but no web ones. `File` is real here
    // (Node 20+) and nameForParsing needs it to rename an extension-less
    // Outlook item; without it that function takes its can't-rename fallback
    // and the rename test would silently pass on the wrong branch.
    File: typeof File !== 'undefined' ? File : undefined,
    Blob: typeof Blob !== 'undefined' ? Blob : undefined,
    // resolveSide reads ?side= through this. Real in Node, same as in every
    // browser -- without it resolveSide throws on load rather than answering,
    // and side-schema.test.js could not pin the two web resource URLs.
    URLSearchParams: typeof URLSearchParams !== 'undefined' ? URLSearchParams : undefined,
    document: { getElementById: () => null, createElement: () => ({ style: {} }) },
    DocparseEngine: undefined, XLSX: undefined,
  };
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: 'app-src.js' });
  cached[slot] = sandbox.__app;
  return cached[slot];
}

// A throwaway copy of the demo fixture. Every conflict case mutates one of these
// rather than the shipped file, so invented values stay out of the repo -- and no
// corpus document is involved at any point.
function demoClone(app) {
  return JSON.parse(JSON.stringify(app.DEMO_ATTACHMENTS));
}

// The value of one extracted field on one attachment, by its printed label.
function setDemoField(attachments, typeKey, label, value) {
  const entry = attachments[typeKey];
  const doc = entry && entry.docs && entry.docs[0];
  const f = doc && doc.fields.find(x => x.label === label);
  if (!f) throw new Error(`no field "${label}" on ${typeKey} -- has the fixture changed?`);
  f.value = value;
  return attachments;
}

module.exports = { load, demoClone, setDemoField, APP_PATH };
