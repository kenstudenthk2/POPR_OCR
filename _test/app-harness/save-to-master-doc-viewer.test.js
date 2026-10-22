/* save-to-master-doc-viewer.test.js
   ---------------------------------
   Tests the Save to Master Document Viewer flow and multi-radio selector on dev side.
   Run: node _test/app-harness/save-to-master-doc-viewer.test.js
*/

const { load } = require('./app.js');
const React = require('react');
const ReactDOMServer = require('react-dom/server');

const app = load({ react: true });

let passed = 0;
const failures = [];

function ok(label, cond, detail) {
  if (cond) {
    passed++;
    return;
  }
  failures.push(label + (detail === undefined ? '' : '\n      got: ' + JSON.stringify(detail).slice(0, 400)));
}

function eq(label, actual, expected) {
  ok(label, actual === expected, { actual, expected });
}

console.log('Testing Save to Master Document Viewer flow...');

// 1. Version and Feature flag
eq('APP_VERSION is 5.32.1', app.APP_VERSION, '5.32.1');
ok('FEATURES.saveToMasterDocViewer is true on dev side', app.FEATURES.saveToMasterDocViewer === true);

// 2. defaultSaveToMasterDocKeys
const defaultKeys = app.defaultSaveToMasterDocKeys(app.DEMO_ATTACHMENTS);
ok('defaultSaveToMasterDocKeys returns a Set', defaultKeys && typeof defaultKeys.has === 'function' && typeof defaultKeys.add === 'function');
ok('defaultSaveToMasterDocKeys includes Vendor Quotation doc', defaultKeys.has('Vendor Quotation#0'));
ok('defaultSaveToMasterDocKeys excludes Contract doc by default', !defaultKeys.has('Contract#0'));
ok('defaultSaveToMasterDocKeys excludes ATQ doc by default', !defaultKeys.has('ATQ#0'));
ok('defaultSaveToMasterDocKeys excludes Excel doc by default', !defaultKeys.has('Excel#0'));

// 3. LisRemarkPage renders and has Save to master button
let openViewerCalledWith = null;
const mockOpenViewer = (typeKey, docIndex, page, only, extra) => {
  openViewerCalledWith = { typeKey, docIndex, page, only, extra };
};

const lisProps = {
  fields: app.initialFormState(true),
  lisRowValues: {},
  attachments: app.DEMO_ATTACHMENTS,
  itemIndex: 0,
  selectItem: () => {},
  itemRecordIds: [],
  savedRecordIds: {},
  processAnotherItem: () => {},
  goUpload: () => {},
  goSave: () => {},
  saving: false,
  recordId: 'REC-123',
  savedRecordId: '',
  setField: () => {},
  adminMode: false,
  records: [],
  lisStartWritten: {},
  processedItems: {},
  openViewer: mockOpenViewer,
};

const lisHtml = ReactDOMServer.renderToStaticMarkup(
  React.createElement(app.LisRemarkPage, lisProps)
);

ok('LisRemarkPage renders Save to master button', lisHtml.includes('Save to master'));

// 4. DocumentViewer renders in saveToMasterMode
const viewerProps = {
  viewer: { typeKey: 'Vendor Quotation', docIndex: 0, saveToMaster: true },
  attachments: app.DEMO_ATTACHMENTS,
  onClose: () => {},
  crosschecks: [],
  dismissedDiffs: new Set(),
  toggleDismissDiff: () => {},
  setField: () => {},
  fields: app.initialFormState(true),
  openViewer: mockOpenViewer,
  census: null,
  inline: false,
  canSaveToMaster: true,
  onSaveToMaster: () => {},
  saving: false,
  savedRecordId: null,
  uploadProgress: null,
};

const viewerHtml = ReactDOMServer.renderToStaticMarkup(
  React.createElement(app.DocumentViewer, viewerProps)
);

ok('DocumentViewer renders "Select Documents to Pass" in saveToMasterMode',
  viewerHtml.includes('Select Documents to Pass'));
ok('DocumentViewer displays selected documents count for flow',
  viewerHtml.includes('selected for flow'));
ok('DocumentViewer renders Save to master primary button in header',
  viewerHtml.includes('Save to master'));
ok('DocumentViewer renders checkbox/radio selectors for documents',
  viewerHtml.includes('role="checkbox"'));

// 5. Normal DocumentViewer (canSaveToMaster = false) does not render Save to master or selection header
const normalViewerProps = {
  ...viewerProps,
  viewer: { typeKey: 'Vendor Quotation', docIndex: 0 },
  canSaveToMaster: false,
};

const normalViewerHtml = ReactDOMServer.renderToStaticMarkup(
  React.createElement(app.DocumentViewer, normalViewerProps)
);

ok('Normal DocumentViewer does not render "Select Documents to Pass"',
  !normalViewerHtml.includes('Select Documents to Pass'));
ok('Normal DocumentViewer does not render Save to master button in header',
  !normalViewerHtml.includes('Save to master'));

// 6. saveAttachmentToPowerFlow with selectedDocs
ok('saveAttachmentToPowerFlow is a function', typeof app.saveAttachmentToPowerFlow === 'function');

console.log(`\nResults: ${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  failures.forEach(f => console.error('  FAIL:', f));
  process.exit(1);
}
