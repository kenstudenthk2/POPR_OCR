const { load } = require('./app.js');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const assert = require('assert');
const fs = require('fs');
const path = require('path');

{
  const app = load({ react: true, side: 'dev' });
  assert.strictEqual(app.excelCopyValues({ customerName: 'Acme', vendor: 'Vendor' }, { customerName: 1, vendor: 3 }), 'Acme\t\tVendor');
  assert.strictEqual(app.excelCopyValues({ customerName: 0 }, { customerName: 2 }), '\t0');
  const moved = app.excelAssignPosition({ customerName: 1, vendor: 3 }, 'vendor', 1);
  assert.strictEqual(moved.vendor, 1);
  assert.strictEqual(moved.customerName, undefined);
  assert(!app.EXCEL_MASTER_COLUMNS.some(c => c.label === 'Action'));
  assert(app.EXCEL_MASTER_COLUMNS.some(c => c.label === 'Customer Address'));
  const master = fs.readFileSync(path.join(__dirname, '..', '..', 'Master page_21-Sep-2026.html'), 'utf8');
  const config = master.slice(master.indexOf('const COLUMN_CONFIG = ['), master.indexOf('const STATUS_TABS = ['));
  const labels = [...config.matchAll(/key:\s*"([^"]+)",\s*label:\s*"([^"]+)"/g)].filter(m => m[1] !== 'Actions').map(m => m[2]).sort();
  assert.deepStrictEqual(Array.from(app.EXCEL_MASTER_COLUMNS, c => c.label).sort(), Array.from(new Set([...labels, 'Created'])).sort());
  assert.deepStrictEqual(JSON.parse(JSON.stringify(app.excelMasterPatch({ customerName: 'Old' }, { customerName: 'New' }))), { admin_customerx0020name: 'New' });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(app.excelMasterPatch({ customerName: 'Old', prNo: '1' }, { customerName: 'Old', prNo: '2' }))), {});
  assert.deepStrictEqual(JSON.parse(JSON.stringify(app.excelMasterPatch({ customerName: 'Old' }, { customerName: '' }))), { admin_customerx0020name: '' });
}

for (const side of ['dev', 'admin']) {
  const app = load({ react: true, side });
  const props = {
    fields: app.initialFormState(true), lisRowValues: {}, attachments: { ATQ: { parsed: true, records: [2, 3].map(n => ({ fields: [{ label: 'Item No.', value: String(n) }] })) } },
    itemIndex: 0, selectItem() {}, itemRecordIds: [], savedRecordIds: {},
    processAnotherItem() {}, goUpload() {}, goSave() {}, saving: false,
    recordId: 'REC-123', savedRecordId: '', setField() {}, openViewer() {},
    lisRowValues: { customerName: 'Reviewed customer', prAmount: '0' },
    census: { assigned: { agreement: { doc: { typeKey: 'ATQ', docIndex: 0, fileName: 'agreement.pdf' } } } },
  };
  const render = savedRecordId => renderToStaticMarkup(React.createElement(app.LisRemarkPage, { ...props, savedRecordId }));
  const locked = render('');
  const saved = render('REC-123');
  if (side === 'dev') {
    assert.match(locked, /Reviewed customer/);
    assert.match(locked, />0<\/dd>/);
    assert.match(locked, /agreement\.pdf/);
    assert.match(locked, />Excel View</);
    assert.doesNotMatch(locked, />Top half</);
  } else {
    assert.match(locked, /<fieldset[^>]*disabled=""[^>]*data-section="excel-copy"/);
    assert.match(locked, /<fieldset[^>]*data-section="excel-copy"[^>]*>[\s\S]*?Excel row preview[\s\S]*?<\/fieldset>/);
  }
  assert.match(locked, /<fieldset[^>]*disabled=""[^>]*data-section="remarks"/);
  assert.match(locked, /data-section="remarks-overlay"[^>]*>[\s\S]*?Available after saving the record to master/);
  assert.doesNotMatch(locked, /data-section="excel-overlay"/);
  assert.match(locked, /data-section="another-item-overlay"[^>]*>Available after saving the record to master\./);
  assert.match(locked, /Next<svg[^>]*aria-hidden="true"[^>]*>[\s\S]*?<path d="M9 18l6-6-6-6"/);
  assert.doesNotMatch(saved, /<fieldset[^>]*disabled=""[^>]*data-section="(?:excel-copy|remarks)"/);
  assert.doesNotMatch(saved, /Available after saving the record to master/);
  console.log(`${side}: LIS and remark lock checks passed`);
}
