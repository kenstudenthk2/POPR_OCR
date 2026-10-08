// Tests for Document Workbench "Start" button existing record check and update logic:
//   - Checking if Record_ID (admin_title) exists in admin_btb_lis_excel_datas
//   - Detecting admin_processstatus and formatting status labels
//   - Switching writeLisStartRecord and writeAtqExcelRecord to updateRecord when existing row is found
//
// Run with: node _test/app-harness/start-existing-record.test.js

const { load } = require('./app.js');
const app = load();

let pass = 0, fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; return; }
  fail++;
  console.log('FAIL: ' + msg);
}
function eq(actual, expected, msg) {
  ok(actual === expected, msg + '\n  expected: ' + JSON.stringify(expected) + '\n  actual:   ' + JSON.stringify(actual));
}

const {
  formatProcessStatusLabel,
  checkExistingLisRecord,
  writeLisStartRecord,
  writeAtqExcelRecord,
  SCHEMA,
} = app;

(async () => {
  /* ---------- 1. formatProcessStatusLabel ---------- */
  eq(formatProcessStatusLabel(0), 'Complete', '0 formats as Complete');
  eq(formatProcessStatusLabel(1), 'Cancelled', '1 formats as Cancelled');
  eq(formatProcessStatusLabel(2), 'PR No. Ready', '2 formats as PR No. Ready');
  eq(formatProcessStatusLabel(3), 'UM Verified', '3 formats as UM Verified');
  eq(formatProcessStatusLabel(4), 'LIS System Approved', '4 formats as LIS System Approved');
  eq(formatProcessStatusLabel(5), 'PO No. Ready', '5 formats as PO No. Ready');
  eq(formatProcessStatusLabel(100000000), 'New Create', '100000000 formats as New Create');
  eq(formatProcessStatusLabel(100000001), 'Data Verifying', '100000001 formats as Data Verifying');
  eq(formatProcessStatusLabel(100000004), 'Create LIS', '100000004 formats as Create LIS');
  eq(formatProcessStatusLabel(100000005), 'Finished', '100000005 formats as Finished');
  eq(formatProcessStatusLabel('Custom Stage'), 'Custom Stage', 'unknown string returns unchanged');
  eq(formatProcessStatusLabel(null), '', 'null returns empty string');
  eq(formatProcessStatusLabel(undefined), '', 'undefined returns empty string');
  eq(formatProcessStatusLabel(''), '', 'empty string returns empty string');
  eq(formatProcessStatusLabel(2, 'PR No. Ready (Formatted)'), 'PR No. Ready (Formatted)', 'formattedVal takes precedence');

  /* ---------- 2. checkExistingLisRecord via mock WebApi ---------- */
  let queryCaptured = '';
  let entityCaptured = '';
  const mockWebApiWithStatus = {
    retrieveMultipleRecords: async (entity, query) => {
      entityCaptured = entity;
      queryCaptured = query;
      return {
        entities: [{
          admin_btb_lis_excel_datasid: 'guid-abc-123',
          admin_title: 'ATQ-202604-00177-1',
          admin_customerx0020name: 'Acme Corp Ltd',
          admin_processstatus: 2,
          'admin_processstatus@OData.Community.Display.V1.FormattedValue': 'PR No. Ready',
        }],
      };
    },
  };

  const foundWithStatus = await checkExistingLisRecord('ATQ-202604-00177-1', mockWebApiWithStatus);
  ok(!!foundWithStatus, 'existing record is returned');
  eq(entityCaptured, 'admin_btb_lis_excel_datas', 'queried entity is admin_btb_lis_excel_datas');
  ok(queryCaptured.includes('$select=admin_title,admin_customerx0020name,admin_processstatus'), 'selects title, customer, and processstatus');
  ok(queryCaptured.includes("$filter=admin_title eq 'ATQ-202604-00177-1'"), 'filters by admin_title');
  eq(foundWithStatus.id, 'guid-abc-123', 'extracts correct row id');
  eq(foundWithStatus.recordId, 'ATQ-202604-00177-1', 'extracts recordId');
  eq(foundWithStatus.customerName, 'Acme Corp Ltd', 'extracts customerName');
  eq(foundWithStatus.processStatus, 2, 'extracts processStatus integer value');
  eq(foundWithStatus.formattedStatus, 'PR No. Ready', 'extracts formattedStatus');

  /* ---------- 3. checkExistingLisRecord without status (null/empty) ---------- */
  const mockWebApiNoStatus = {
    retrieveMultipleRecords: async () => ({
      entities: [{
        admin_btb_lis_excel_datasid: 'guid-no-status-456',
        admin_title: 'ATQ-202604-00177-2',
        admin_customerx0020name: 'Beta Ltd',
        admin_processstatus: null,
      }],
    }),
  };

  const foundNoStatus = await checkExistingLisRecord('ATQ-202604-00177-2', mockWebApiNoStatus);
  ok(!!foundNoStatus, 'existing record without status is returned');
  eq(foundNoStatus.id, 'guid-no-status-456', 'id is present');
  eq(foundNoStatus.processStatus, null, 'processStatus is null');
  eq(foundNoStatus.formattedStatus, '', 'formattedStatus is empty');

  /* ---------- 4. checkExistingLisRecord when not found ---------- */
  const mockWebApiNotFound = {
    retrieveMultipleRecords: async () => ({ entities: [] }),
  };
  const notFound = await checkExistingLisRecord('NON-EXISTENT-ID', mockWebApiNotFound);
  eq(notFound, null, 'returns null when no record exists in Dataverse');

  /* ---------- 5. checkExistingLisRecord fallback to local records ---------- */
  const localList = [
    { recordId: 'REC-DEMO-1', customerName: 'Demo Customer', status: 'Completed', processStatus: 0 },
    { recordId: 'REC-DEMO-2', customerName: 'Pending Customer', status: '', processStatus: null },
  ];
  const localFound1 = await checkExistingLisRecord('REC-DEMO-1', null, localList);
  ok(!!localFound1, 'finds local record in list');
  eq(localFound1.customerName, 'Demo Customer', 'correct customer name from local');
  eq(localFound1.processStatus, 0, 'correct process status 0 (Complete)');

  const localFound2 = await checkExistingLisRecord('REC-DEMO-2', null, localList);
  ok(!!localFound2, 'finds second local record');
  eq(localFound2.processStatus, null, 'local record has no process status');

  /* ---------- 6. writeLisStartRecord: update instead of create when existingId is given ---------- */
  const calls = [];
  const mockWebApiForStart = {
    createRecord: async (entity, payload) => {
      calls.push({ action: 'create', entity, payload });
      return { id: 'new-guid' };
    },
    updateRecord: async (entity, id, payload) => {
      calls.push({ action: 'update', entity, id, payload });
      return {};
    },
  };

  const sampleFields = {
    handledBy: { value: 'Mandy Lee' },
    iptUnitMgr: { value: 'Networking' },
    customerName: { value: 'Acme Corp' },
  };

  // With existingId: must UPDATE, not create
  calls.length = 0;
  await writeLisStartRecord(sampleFields, 'REC-EXISTS', 'UID-001', false, null, mockWebApiForStart, 'BTB', 'ATQ-01', '1', 'guid-target-123');
  eq(calls.length, 1, 'exactly one call made');
  eq(calls[0].action, 'update', 'calls updateRecord when existingId is provided');
  eq(calls[0].entity, 'admin_btb_lis_excel_datas', 'updates admin_btb_lis_excel_datas');
  eq(calls[0].id, 'guid-target-123', 'updates specific existing ID');
  eq(calls[0].payload.admin_title, 'REC-EXISTS', 'payload carries admin_title');

  // Without existingId and no existing record: must CREATE
  calls.length = 0;
  mockWebApiForStart.retrieveMultipleRecords = async () => ({ entities: [] });
  await writeLisStartRecord(sampleFields, 'REC-NEW', 'UID-002', false, null, mockWebApiForStart, 'BTB', 'ATQ-02', '1', null);
  eq(calls.length, 1, 'exactly one call made');
  eq(calls[0].action, 'create', 'calls createRecord when no existing record exists');
  eq(calls[0].entity, 'admin_btb_lis_excel_datas', 'creates in admin_btb_lis_excel_datas');
  eq(calls[0].payload.admin_title, 'REC-NEW', 'payload carries admin_title');

  /* ---------- 7. writeAtqExcelRecord: update when existing record exists ---------- */
  const atqCalls = [];
  const mockWebApiForAtq = {
    retrieveMultipleRecords: async (entity, query) => {
      if (query.includes('ATQ-EXISTS')) {
        return { entities: [{ admin_btb_atq_excelsid: 'guid-atq-999' }] };
      }
      return { entities: [] };
    },
    createRecord: async (entity, payload) => {
      atqCalls.push({ action: 'create', entity, payload });
      return { id: 'new-atq-guid' };
    },
    updateRecord: async (entity, id, payload) => {
      atqCalls.push({ action: 'update', entity, id, payload });
      return {};
    },
  };

  // When atqExcel record exists: must UPDATE
  atqCalls.length = 0;
  await writeAtqExcelRecord(sampleFields, 'ATQ-EXISTS', false, null, mockWebApiForAtq);
  eq(atqCalls.length, 1, 'exactly one call made for existing atqExcel');
  eq(atqCalls[0].action, 'update', 'calls updateRecord for existing atqExcel');
  eq(atqCalls[0].id, 'guid-atq-999', 'updates the found atqExcel id');

  // When atqExcel record does NOT exist: must CREATE
  atqCalls.length = 0;
  await writeAtqExcelRecord(sampleFields, 'ATQ-FRESH', false, null, mockWebApiForAtq);
  eq(atqCalls.length, 1, 'exactly one call made for fresh atqExcel');
  eq(atqCalls[0].action, 'create', 'calls createRecord for fresh atqExcel');

  console.log(`${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
})();
