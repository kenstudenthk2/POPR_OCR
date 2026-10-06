// Tests for To Supplier Remark "Case Type" dropdown and admin_btb_supplier_remark lookup.
//
//   node _test/app-harness/supplier-remark.test.js

const assert = require('assert');
const { load } = require('./app.js');
const app = load();

let passed = 0;
const failures = [];

function ok(label, cond, detail) {
  if (cond) { passed++; return; }
  failures.push(label + (detail === undefined ? '' : '\n      got: ' + JSON.stringify(detail).slice(0, 400)));
}
function eq(label, actual, expected) {
  ok(label, actual === expected, { actual, expected });
}

/* ---------- 1. Schema and Feature verification ---------- */
{
  const devSchema = app.DATAVERSE_SCHEMAS.dev;
  ok('dev schema names supplierRemark', !!devSchema.supplierRemark);
  eq('supplierRemark entity is admin_btb_supplier_remark',
    devSchema.supplierRemark.entity, 'admin_btb_supplier_remark');
  ok('supplierRemark select includes admin_ccc (lowercase for Dataverse WebApi)',
    devSchema.supplierRemark.select.includes('admin_ccc'));
  ok('supplierRemark select includes admin_reamrk (lowercase for Dataverse WebApi)',
    devSchema.supplierRemark.select.includes('admin_reamrk'));
  eq('supplierRemark fields.ccc is admin_ccc',
    devSchema.supplierRemark.fields.ccc, 'admin_ccc');
  eq('supplierRemark fields.remark is admin_reamrk',
    devSchema.supplierRemark.fields.remark, 'admin_reamrk');

  ok('admin schema also names supplierRemark for consistency',
    !!app.DATAVERSE_SCHEMAS.admin.supplierRemark);

  ok('supplierRemarkLookup is enabled on dev side',
    app.FEATURES.supplierRemarkLookup === true);
}

/* ---------- 2. getRowCcc, getRowRemark, and cleanRichTextToPlainText helpers ---------- */
{
  // Lowercase properties from Dataverse OData
  const dvRow = { admin_ccc: 'C716', admin_reamrk: 'Test remark from Dataverse' };
  eq('getRowCcc reads lowercase admin_ccc', app.getRowCcc(dvRow), 'C716');
  eq('getRowRemark reads lowercase admin_reamrk', app.getRowRemark(dvRow), 'Test remark from Dataverse');

  // Upper/Mixed case properties from mock or legacy
  const mockRow = { admin_CCC: 'C801', admin_Reamrk: 'Mock remark' };
  eq('getRowCcc reads uppercase admin_CCC', app.getRowCcc(mockRow), 'C801');
  eq('getRowRemark reads uppercase admin_Reamrk', app.getRowRemark(mockRow), 'Mock remark');

  // Standard spelling admin_remark (no typo in column)
  const cleanRow = { admin_ccc: 'C900', admin_remark: 'Clean remark' };
  eq('getRowCcc reads C900', app.getRowCcc(cleanRow), 'C900');
  eq('getRowRemark reads admin_remark', app.getRowRemark(cleanRow), 'Clean remark');

  // SharePoint / Dataverse Rich Text HTML cleaning
  const richHtml = '<div class="ExternalClass6FFF849ED4F74276886A19202FBF7462">' +
    '<div style="font-family&#58;Calibri;font-size&#58;11pt;">' +
    '<span style="font-size&#58;12pt;">NON-BTB Mtce Case, Cost absorbed by COS</span></div>' +
    '<p style="margin&#58;0cm;font-family&#58;&quot;Times New Roman&quot;;">' +
    '<span lang="EN-US">1)</span>' +
    '<span>&#160;&#160;&#160;&#160;Item line</span></p></div>';

  const cleaned = app.cleanRichTextToPlainText(richHtml);
  ok('cleanRichTextToPlainText removes ExternalClass div and tags', !cleaned.includes('ExternalClass') && !cleaned.includes('<div'));
  ok('cleanRichTextToPlainText keeps first line', cleaned.includes('NON-BTB Mtce Case, Cost absorbed by COS'));
  ok('cleanRichTextToPlainText keeps second line with line break', cleaned.includes('1)    Item line'));
  ok('cleanRichTextToPlainText decodes &#58; and &#160;', !cleaned.includes('&#58;') && !cleaned.includes('&#160;'));

  // getRowRemark automatically cleans rich text
  const richRow = { admin_ccc: 'C665', admin_reamrk: richHtml };
  const remarkFromRow = app.getRowRemark(richRow);
  ok('getRowRemark cleans rich HTML into plain text', !remarkFromRow.includes('<') && remarkFromRow.includes('NON-BTB Mtce Case'));

  // Null/empty handling
  eq('getRowCcc handles null', app.getRowCcc(null), '');
  eq('getRowRemark handles null', app.getRowRemark(null), '');
  eq('cleanRichTextToPlainText handles null', app.cleanRichTextToPlainText(null), '');
}

/* ---------- 3. interpolateRemark ---------- */
{
  const fields = {
    customerName: { value: 'Global Financial Services Ltd' },
    vendor: { value: 'Cisco Systems HK' },
    poPrDescription: { value: 'Firewall Hardware Upgrade' },
    quotationStartDate: { value: '2026-04-01' },
    quotationEndDate: { value: '2027-03-31' },
    quotation: { value: 'QT-2026-9901' },
    contractNo: { value: 'AG-2026-0088' },
    atqRefNo: { value: 'ATQ-202604-00555' },
    hkd: { value: '250,000.00' },
    chargeCcc: { value: 'C716' },
  };

  const contact = {
    key: 'Chan, Abby NY',
    title: 'Ms.',
    name: 'Abby Chan',
    phone: '2883 0385',
  };

  // Direct column value test (no placeholder tokens)
  const rawRemark = 'Remarks: Pls refer att\'d quotation & document for details information.\nAttached quote for your reference only.';
  eq('returns verbatim text when no tokens are present',
    app.interpolateRemark(rawRemark, fields, contact, 'Lee, Mandy MY'),
    rawRemark);

  // Empty / null handling
  eq('returns empty string for null template', app.interpolateRemark(null), '');
  eq('returns empty string for empty template', app.interpolateRemark(''), '');

  // Token interpolation
  const templated = [
    'PR Issued by {PR Issued by}',
    '{Contact}',
    'Enduser: {Enduser}',
    'SI: {SI}',
    'Period: {Period}',
    'Purchase of {Purchase of}',
    'Quotation: {Quotation No}',
    'Contract: {Contract No}',
    'Amount: {HKD}',
    'CCC: {Charge CCC}',
  ].join('\n');

  const result = app.interpolateRemark(templated, fields, contact, 'Chow, Alice SW');

  ok('interpolates {PR Issued by} with admin name and phone',
    result.includes('PR Issued by Chow, Alice SW@28831026'), result);
  ok('interpolates {Contact} line with title, name, phone',
    result.includes('For case details, please contact Ms. Abby Chan at 2883 0385'), result);
  ok('interpolates {Enduser} with Customer Name',
    result.includes('Enduser: Global Financial Services Ltd'), result);
  ok('interpolates {SI} with Vendor',
    result.includes('SI: Cisco Systems HK'), result);
  ok('interpolates {Period} with dates and calculated months',
    result.includes('Period: 2026-04-01 to 2027-03-31 (12 Mths)'), result);
  ok('interpolates {Purchase of} with description',
    result.includes('Purchase of Firewall Hardware Upgrade'), result);
  ok('interpolates {Quotation No}',
    result.includes('Quotation: QT-2026-9901'), result);
  ok('interpolates {Contract No}',
    result.includes('Contract: AG-2026-0088'), result);
  ok('interpolates {HKD}',
    result.includes('Amount: 250,000.00'), result);
  ok('interpolates {Charge CCC}',
    result.includes('CCC: C716'), result);

  // Case-insensitivity test for tokens
  const lowerTemplated = 'User: {enduser}, Vendor: {vendor}, Desc: {description}';
  const lowerResult = app.interpolateRemark(lowerTemplated, fields, contact);
  eq('tokens are case-insensitive',
    lowerResult,
    'User: Global Financial Services Ltd, Vendor: Cisco Systems HK, Desc: Firewall Hardware Upgrade');
}

/* ---------- 4. fetchSupplierRemarkRows ---------- */
{
  // Test fallback when no WebApi is present
  const promise = app.fetchSupplierRemarkRows();
  ok('fetchSupplierRemarkRows returns a Promise', promise && typeof promise.then === 'function');

  promise.then(rows => {
    ok('returns fallback rows when Xrm.WebApi is absent', Array.isArray(rows) && rows.length > 0);
    ok('fallback includes C716', rows.some(r => app.getRowCcc(r) === 'C716'));
    ok('fallback includes Others', rows.some(r => app.getRowCcc(r) === 'Others'));

    /* ---------- 5. React render test for LisRemarkPage ---------- */
    const { renderToStaticMarkup } = require('react-dom/server');
    const React = require('react');
    const reactApp = load({ react: true });

    const fields = reactApp.initialFormState();
    const noop = () => {};
    const lisRemarkProps = {
      fields, lisRowValues: {}, attachments: reactApp.DEMO_ATTACHMENTS, itemIndex: 0, selectItem: noop,
      goUpload: noop, goSave: noop, saving: false, savedRecordId: '', setField: noop,
    };

    const html = renderToStaticMarkup(React.createElement(reactApp.LisRemarkPage, lisRemarkProps));
    ok('LisRemarkPage renders successfully', typeof html === 'string' && html.length > 0);
    ok('Case Type label is present', html.includes('Case Type :'));
    ok('Dropdown trigger for Case Type is rendered on dev side',
      html.includes('— Select Case Type —') || html.includes('C716'));
    ok('Remark fields for auto-match hint is displayed',
      html.includes('Remark fields for auto-match:'));
    ok('{Enduser} token is listed in the helper text',
      html.includes('{Enduser}'));
    ok('{SI} token is listed in the helper text',
      html.includes('{SI}'));
    ok('{Period} token is listed in the helper text',
      html.includes('{Period}'));

    console.log(passed + ' passed, ' + failures.length + ' failed');
    if (failures.length) {
      failures.forEach(f => console.error('  FAIL  ' + f));
      process.exit(1);
    }
  }).catch(err => {
    console.error('Unexpected error in fetchSupplierRemarkRows test:', err);
    process.exit(1);
  });
}
