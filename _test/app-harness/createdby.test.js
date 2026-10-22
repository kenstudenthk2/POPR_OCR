// Unit and integration tests for createdby text trimming and recording into admin_createdbyname,
// admin dropdown on Document Workbench, and populating admin_issuex0020by when creating the record.
//
//   node _test/app-harness/createdby.test.js

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
  extractCreatedByName,
  retrieveRecordCreatedBy,
  syncCreatedByName,
  pollAndSyncCreatedBy,
  writeLisStartRecord,
  writeLisExcelRecord,
  buildLisExcelPayload,
  buildLisStartPayload,
  fetchDistinctAdminNames,
  lookupAdminNameByEmail,
  fetchAdminUserList,
  resetAdminUserListCache,
  DATAVERSE_SCHEMAS,
  BTB_ADMIN_NAMES,
  PROCESS_ADMIN_STORAGE_KEY,
  getSavedProcessAdmin,
  saveProcessAdmin,
} = app;

(async () => {
  /* ---------- 1. extractCreatedByName trimming logic ---------- */
  // The exact example from the user prompt:
  eq(
    extractCreatedByName('i:0#.f|membership|02007572 @corphq.hk.pccw.com'),
    '02007572@corphq.hk.pccw.com',
    'trims value after "|" and removes whitespace: exact prompt example'
  );

  // Standard SharePoint claims identity without internal space:
  eq(
    extractCreatedByName('i:0#.f|membership|02007572@corphq.hk.pccw.com'),
    '02007572@corphq.hk.pccw.com',
    'extracts clean email without internal space'
  );

  // Single pipe format:
  eq(
    extractCreatedByName('membership|john.doe@pccw.com'),
    'john.doe@pccw.com',
    'handles single pipe format'
  );

  // Multiple pipes format:
  eq(
    extractCreatedByName('c:0(.s|true|i:0#.f|membership|alice.wong@corphq.hk.pccw.com'),
    'alice.wong@corphq.hk.pccw.com',
    'takes value after the last pipe'
  );

  // Leading and trailing spaces with internal space around @:
  eq(
    extractCreatedByName('   admin.user @ domain.com   '),
    'admin.user@domain.com',
    'handles plain string with surrounding and internal whitespace'
  );

  // Plain email already formatted:
  eq(
    extractCreatedByName('02007572@corphq.hk.pccw.com'),
    '02007572@corphq.hk.pccw.com',
    'preserves already clean email'
  );

  // Falsy and empty values:
  eq(extractCreatedByName(''), '', 'empty string returns empty');
  eq(extractCreatedByName(null), '', 'null returns empty');
  eq(extractCreatedByName(undefined), '', 'undefined returns empty');

  /* ---------- 2. Schema mapping checks ---------- */
  const devLis = DATAVERSE_SCHEMAS.dev.lis;
  eq(devLis.fields.createdbytext, 'admin_createdbytext', 'dev lis fields maps createdbytext to admin_createdbytext');
  eq(devLis.fields.createdbyname, 'admin_createdbyname', 'dev lis fields maps createdbyname to admin_createdbyname');
  eq(devLis.fields.issueBy, 'admin_issuex0020by', 'dev lis fields maps issueBy to admin_issuex0020by');
  eq(devLis.write.createdbytext, 'admin_createdbytext', 'dev lis write maps createdbytext to admin_createdbytext');
  eq(devLis.write.createdbyname, 'admin_createdbyname', 'dev lis write maps createdbyname to admin_createdbyname');
  eq(devLis.write.issueBy, 'admin_issuex0020by', 'dev lis write maps issueBy to admin_issuex0020by');
  eq(devLis.records.createdbytext, 'admin_createdbytext', 'dev lis records maps createdbytext to admin_createdbytext');
  eq(devLis.records.createdbyname, 'admin_createdbyname', 'dev lis records maps createdbyname to admin_createdbyname');
  ok(devLis.select.includes('admin_createdbytext'), 'dev lis select includes admin_createdbytext');
  ok(devLis.select.includes('admin_createdbyname'), 'dev lis select includes admin_createdbyname');

  const adminUserListSchema = DATAVERSE_SCHEMAS.dev.adminUserList;
  ok(!!adminUserListSchema, 'dev schema names adminUserList table');
  eq(adminUserListSchema.entity, 'admin_btb_admin_user_list', 'adminUserList entity name');
  eq(adminUserListSchema.fields.corphqEmail, 'admin_admin1corphqemail', 'maps corphqEmail to admin_admin1corphqemail');
  eq(adminUserListSchema.fields.adminName, 'admin_admin1name', 'maps adminName to admin_admin1name');

  /* ---------- 3. lookupAdminNameByEmail unit tests ---------- */
  resetAdminUserListCache();
  const mockAdminUserListApi = {
    retrieveMultipleRecords: async (entity, query) => {
      eq(entity, 'admin_btb_admin_user_list', 'queries admin_btb_admin_user_list');
      if (query.includes("admin_admin1corphqemail eq '02007572@corphq.hk.pccw.com'")) {
        return {
          entities: [{
            admin_admin1corphqemail: '02007572@corphq.hk.pccw.com',
            admin_admin1name: 'Lee, Mandy MY',
          }],
        };
      }
      if (query.includes("admin_admin1corphqemail eq 'unknown@corphq.hk.pccw.com'")) {
        return { entities: [] };
      }
      // Full table scan fallback:
      return {
        entities: [
          { admin_admin1corphqemail: '02007572@corphq.hk.pccw.com', admin_admin1name: 'Lee, Mandy MY' },
          { admin_admin1corphqemail: '02001111@corphq.hk.pccw.com', admin_admin1name: 'Chow, Alice SW' },
        ],
      };
    },
  };

  const foundName = await lookupAdminNameByEmail('02007572@corphq.hk.pccw.com', mockAdminUserListApi);
  eq(foundName, 'Lee, Mandy MY', 'finds admin name by exact email query');

  resetAdminUserListCache();
  const foundWithWhitespace = await lookupAdminNameByEmail('  02007572@corphq.hk.pccw.com  ', mockAdminUserListApi);
  eq(foundWithWhitespace, 'Lee, Mandy MY', 'finds admin name with surrounding whitespace');

  resetAdminUserListCache();
  const notFoundName = await lookupAdminNameByEmail('unknown@corphq.hk.pccw.com', mockAdminUserListApi);
  eq(notFoundName, '', 'returns empty string for unknown email');

  /* ---------- 4. fetchDistinctAdminNames unit tests (deduplication & fallback) ---------- */
  // Tests getting distinct values of admin_admin1name from table admin_btb_admin_user_list
  const mockApiWithDuplicates = {
    retrieveMultipleRecords: async (entity, query) => {
      return {
        entities: [
          { admin_admin1name: 'Yeung, May SM' },
          { admin_admin1name: 'Lee, Mandy MY' },
          { admin_admin1name: 'Yeung, May SM' }, // duplicate
          { admin_admin1name: 'Chow, Alice SW' },
          { admin_admin1name: 'Lee, Mandy MY' }, // duplicate
          { admin_admin1name: '  ' }, // empty
        ],
      };
    },
  };

  const distinctNames = await fetchDistinctAdminNames(mockApiWithDuplicates);
  eq(distinctNames.length, 3, 'deduplicates admin names list');
  eq(distinctNames[0], 'Chow, Alice SW', 'sorted alphabetically index 0');
  eq(distinctNames[1], 'Lee, Mandy MY', 'sorted alphabetically index 1');
  eq(distinctNames[2], 'Yeung, May SM', 'sorted alphabetically index 2');

  // Fallback to BTB_ADMIN_NAMES when webApi is null or empty
  const fallbackNames = await fetchDistinctAdminNames(null);
  ok(Array.isArray(fallbackNames) && fallbackNames.length === BTB_ADMIN_NAMES.length, 'falls back to BTB_ADMIN_NAMES when no API');
  eq(new Set(fallbackNames).size, fallbackNames.length, 'fallback list has no duplicates');

  /* ---------- 5. buildLisStartPayload maps issueBy to admin_issuex0020by ---------- */
  const startPayloadWithAdmin = buildLisStartPayload(
    {
      handledBy: { value: 'Mandy Lee' },
      iptUnitMgr: { value: 'Networking' },
      issueBy: { value: 'Chow, Alice SW' },
    },
    'REC-001',
    'UID-001',
    'BTB'
  );

  eq(startPayloadWithAdmin.admin_issuex0020by, 'Chow, Alice SW', 'buildLisStartPayload maps issueBy to admin_issuex0020by');
  eq(startPayloadWithAdmin.admin_title, 'REC-001', 'buildLisStartPayload maps recordId to admin_title');

  /* ---------- 6. syncCreatedByName updates admin_createdbyname ONLY (no lookup/fill of issueBy) ---------- */
  resetAdminUserListCache();
  const updateCalls = [];
  const mockWebApiWithAdminUserList = {
    retrieveRecord: async (entity, id, options) => {
      eq(entity, 'admin_btb_lis_excel_datas', 'retrieveRecord targets admin_btb_lis_excel_datas');
      return {
        admin_createdbytext: 'i:0#.f|membership|02007572 @corphq.hk.pccw.com',
        admin_createdbyname: null,
        admin_issuex0020by: null,
      };
    },
    retrieveMultipleRecords: async (entity, query) => {
      return { entities: [] };
    },
    updateRecord: async (entity, id, payload) => {
      updateCalls.push({ entity, id, payload });
      return {};
    },
  };

  const sampleFieldsObj = {
    issueBy: { value: 'Original Admin' },
  };

  const synced = await syncCreatedByName('admin_btb_lis_excel_datas', '{guid-123}', mockWebApiWithAdminUserList, 0, 100, sampleFieldsObj);
  ok(synced, 'syncCreatedByName returns true when update performed');
  eq(updateCalls.length, 1, 'exactly one updateRecord call made');
  eq(updateCalls[0].entity, 'admin_btb_lis_excel_datas', 'updates admin_btb_lis_excel_datas');
  eq(updateCalls[0].id, 'guid-123', 'updates cleaned guid-123');
  eq(updateCalls[0].payload.admin_createdbyname, '02007572@corphq.hk.pccw.com', 'records trimmed email in admin_createdbyname');
  eq(updateCalls[0].payload.admin_issuex0020by, undefined, 'does NOT patch admin_issuex0020by (lookup/fill removed)');
  eq(sampleFieldsObj.issueBy.value, 'Original Admin', 'does NOT mutate fieldsSnapshot.issueBy');

  // When admin_createdbyname is already set, do not update again
  updateCalls.length = 0;
  const mockAlreadySet = {
    retrieveRecord: async () => ({
      admin_createdbytext: 'i:0#.f|membership|02007572 @corphq.hk.pccw.com',
      admin_createdbyname: '02007572@corphq.hk.pccw.com',
      admin_issuex0020by: 'Original Admin',
    }),
    updateRecord: async (entity, id, payload) => {
      updateCalls.push({ entity, id, payload });
      return {};
    },
  };
  await syncCreatedByName('admin_btb_lis_excel_datas', 'guid-123', mockAlreadySet, 0);
  eq(updateCalls.length, 0, 'no updateRecord call when admin_createdbyname is already current');

  /* ---------- 7. writeLisStartRecord end-to-end integration: fills admin_issuex0020by on create ---------- */
  resetAdminUserListCache();
  const startCalls = [];
  const mockWebApiForStart = {
    createRecord: async (entity, payload) => {
      startCalls.push({ action: 'create', entity, payload });
      return { id: 'created-row-guid' };
    },
    retrieveRecord: async (entity, id) => {
      startCalls.push({ action: 'retrieve', entity, id });
      return {
        admin_createdbytext: 'i:0#.f|membership|02007572 @corphq.hk.pccw.com',
        admin_createdbyname: null,
        admin_issuex0020by: 'Chow, Alice SW',
      };
    },
    updateRecord: async (entity, id, payload) => {
      startCalls.push({ action: 'update', entity, id, payload });
      return {};
    },
  };

  const sampleFields = {
    handledBy: { value: 'Mandy Lee' },
    iptUnitMgr: { value: 'Networking' },
    customerName: { value: 'Test Customer' },
    issueBy: { value: 'Chow, Alice SW' }, // Chosen from dropdown!
  };

  const err = await writeLisStartRecord(sampleFields, 'REC-START-01', 'UID-001', false, null, mockWebApiForStart, 'BTB', 'ATQ-01', '1', null);
  eq(err, '', 'writeLisStartRecord succeeds without error');

  // Expect create payload to directly contain admin_issuex0020by!
  const createCall = startCalls.find(c => c.action === 'create');
  ok(!!createCall, 'created record in Dataverse');
  eq(createCall.payload.admin_title, 'REC-START-01', 'recordId set on create payload');
  eq(createCall.payload.admin_issuex0020by, 'Chow, Alice SW', 'selected admin name filled to admin_btb_lis_excel_datas.admin_issuex0020by when creating record');

  // And background sync sets admin_createdbyname without touching admin_issuex0020by
  const updateCall = startCalls.find(c => c.action === 'update' && c.payload.admin_createdbyname);
  ok(!!updateCall, 'updated record with admin_createdbyname');
  eq(updateCall.id, 'created-row-guid', 'updates correct created record ID');
  eq(updateCall.payload.admin_createdbyname, '02007572@corphq.hk.pccw.com', 'trimmed email recorded correctly in admin_createdbyname');
  eq(updateCall.payload.admin_issuex0020by, undefined, 'does not overwrite admin_issuex0020by in background sync');

  /* ---------- 8. Asynchronous filling of admin_createdbytext after record creation ---------- */
  resetAdminUserListCache();
  let pollAttempts = 0;
  const pollUpdates = [];
  const mockWebApiAsyncFlow = {
    retrieveRecord: async (entity, id) => {
      pollAttempts++;
      if (pollAttempts < 3) {
        return {
          admin_createdbytext: null,
          admin_createdbyname: null,
          admin_issuex0020by: 'Chow, Alice SW',
        };
      }
      return {
        admin_createdbytext: 'i:0#.f|membership|02007572 @corphq.hk.pccw.com',
        admin_createdbyname: null,
        admin_issuex0020by: 'Chow, Alice SW',
      };
    },
    updateRecord: async (entity, id, payload) => {
      pollUpdates.push({ entity, id, payload });
      return {};
    },
  };

  const asyncField = { issueBy: { value: 'Chow, Alice SW' } };
  const asyncResult = await pollAndSyncCreatedBy(
    'admin_btb_lis_excel_datas',
    'guid-async-999',
    mockWebApiAsyncFlow,
    5,
    20,
    asyncField
  );

  ok(asyncResult, 'pollAndSyncCreatedBy succeeds when value appears on attempt 3');
  eq(pollAttempts, 3, 'polled 3 times until admin_createdbytext appeared');
  eq(pollUpdates.length, 1, 'updated record once value appeared');
  eq(pollUpdates[0].payload.admin_createdbyname, '02007572@corphq.hk.pccw.com', 'saved admin_createdbyname after async fill');
  eq(pollUpdates[0].payload.admin_issuex0020by, undefined, 'did not overwrite admin_issuex0020by during async sync');

  /* ---------- 9. writeLisExcelRecord (Continue to save on Verify Table) integration ---------- */
  resetAdminUserListCache();
  const excelSaveCalls = [];
  const mockWebApiForExcelSave = {
    createRecord: async (entity, payload) => {
      excelSaveCalls.push({ action: 'create', entity, payload });
      return { id: 'created-excel-guid' };
    },
    retrieveRecord: async (entity, id) => {
      excelSaveCalls.push({ action: 'retrieve', entity, id });
      return {
        admin_createdbytext: 'i:0#.f|membership|02007572 @corphq.hk.pccw.com',
        admin_createdbyname: null,
        admin_issuex0020by: 'Chow, Alice SW',
      };
    },
    updateRecord: async (entity, id, payload) => {
      excelSaveCalls.push({ action: 'update', entity, id, payload });
      return {};
    },
  };

  const verifyValues = {
    customerName: 'Test Corp',
    vendor: 'Cisco',
    prAmount: '10000',
    issueBy: 'Chow, Alice SW',
  };

  let markedExcelWritten = false;
  const saveErr = await writeLisExcelRecord(verifyValues, 'REC-EXCEL-01', false, () => { markedExcelWritten = true; }, mockWebApiForExcelSave, null);
  eq(saveErr, '', 'writeLisExcelRecord succeeds without error');
  ok(markedExcelWritten, 'marked as written after createRecord');

  const excelCreate = excelSaveCalls.find(c => c.action === 'create');
  ok(!!excelCreate, 'created record in admin_btb_lis_excel_datas at Continue to save');
  eq(excelCreate.payload.admin_issuex0020by, 'Chow, Alice SW', 'records selected admin name to admin_issuex0020by on create');

  const excelUpdate = excelSaveCalls.find(c => c.action === 'update' && c.payload.admin_createdbyname);
  ok(!!excelUpdate, 'synced admin_createdbyname at Continue to save');
  eq(excelUpdate.payload.admin_createdbyname, '02007572@corphq.hk.pccw.com', 'trimmed email saved to admin_createdbyname');
  eq(excelUpdate.payload.admin_issuex0020by, undefined, 'did not overwrite admin_issuex0020by at Continue to save');

  // Verify buildLisExcelPayload directly with and without issueBy
  const payloadWithAdmin = buildLisExcelPayload({ customerName: 'Test Corp', issueBy: 'Chow, Alice SW' }, 'REC-EXCEL-01');
  eq(payloadWithAdmin.admin_issuex0020by, 'Chow, Alice SW', 'buildLisExcelPayload maps issueBy to admin_issuex0020by');

  const payloadWithoutAdmin = buildLisExcelPayload({ customerName: 'Test Corp' }, 'REC-EXCEL-01');
  eq(payloadWithoutAdmin.admin_issuex0020by, undefined, 'buildLisExcelPayload drops empty issueBy');

  /* ---------- 10. UploadPage rendering: Admin picker and upload box disabling ---------- */
  const { renderToStaticMarkup } = require('react-dom/server');
  const React = require('react');
  const reactApp = load({ react: true });
  const noop = () => {};

  const emptyFieldsWithoutAdmin = reactApp.initialFormState(false);
  const uploadPropsDisabled = {
    attachments: reactApp.EMPTY_ATTACHMENTS,
    setAttachments: noop,
    activeTab: 'Vendor Quotation',
    setActiveTab: noop,
    fields: emptyFieldsWithoutAdmin,
    setField: noop,
    setFieldAuto: noop,
    applyMatches: noop,
    applyUid: noop,
    detectFromRoles: noop,
    goProcess: noop,
    goVerify: noop,
    demoMode: false,
    adminMode: false,
    toggleDemo: noop,
    openViewer: noop,
    crosschecks: {},
    dismissedDiffs: new Set(),
    toggleDismissDiff: noop,
    itemIndex: 0,
    setItemIndex: noop,
    selectItem: noop,
    resetRecordData: noop,
    census: {},
    autoCensus: {},
    roleOverrides: {},
    setRoleOverrides: noop,
  };

  const htmlDisabled = renderToStaticMarkup(React.createElement(reactApp.UploadPage, uploadPropsDisabled));
  ok(htmlDisabled.includes('Select Admin to Process Record'), 'renders Select Admin to Process Record dropdown header');
  ok(htmlDisabled.includes('— Select Admin Name —'), 'renders Admin Name placeholder');
  ok(htmlDisabled.includes('disabled=""') || htmlDisabled.includes('disabled'), 'upload button is disabled before choosing admin');
  ok(htmlDisabled.includes('Please choose an admin above to enable uploading'), 'displays instruction banner when upload is disabled');
  ok(htmlDisabled.includes('cursor-not-allowed'), 'upload box carries cursor-not-allowed when disabled');

  // When admin is chosen:
  const fieldsWithAdmin = reactApp.initialFormState(false);
  fieldsWithAdmin.issueBy = { value: 'Chan, Candy WS', auto: false };
  const uploadPropsEnabled = Object.assign({}, uploadPropsDisabled, {
    fields: fieldsWithAdmin,
  });

  const htmlEnabled = renderToStaticMarkup(React.createElement(reactApp.UploadPage, uploadPropsEnabled));
  ok(htmlEnabled.includes('Chan, Candy WS'), 'renders selected admin name in dropdown');
  ok(!htmlEnabled.includes('Please choose an admin above to enable uploading'), 'disabling banner is removed when admin is chosen');
  ok(htmlEnabled.includes('clickable-cue'), 'upload box carries clickable-cue when enabled');

  /* ---------- 11. Process admin browser persistence and lock/edit on Document Workbench ---------- */
  eq(PROCESS_ADMIN_STORAGE_KEY, 'processadmin', 'storage key is "processadmin"');

  // Test getSavedProcessAdmin and saveProcessAdmin helper functions with sandbox localStorage
  const mockStorage = {};
  reactApp.sandbox.localStorage = {
    getItem: k => (k in mockStorage ? mockStorage[k] : null),
    setItem: (k, v) => { mockStorage[k] = String(v); },
    removeItem: k => { delete mockStorage[k]; },
  };

  // Initially empty
  eq(reactApp.getSavedProcessAdmin(), '', 'getSavedProcessAdmin returns empty string when storage empty');

  // Save admin
  reactApp.saveProcessAdmin('Lee, Mandy MY');
  eq(mockStorage['processadmin'], 'Lee, Mandy MY', 'saveProcessAdmin writes to "processadmin" key in localStorage');
  eq(reactApp.getSavedProcessAdmin(), 'Lee, Mandy MY', 'getSavedProcessAdmin reads saved admin name');

  // Render UploadPage with saved admin in localStorage (detects saved value)
  const uploadPropsWithStorage = Object.assign({}, uploadPropsDisabled, {
    fields: reactApp.initialFormState(false),
  });
  const htmlWithStorage = renderToStaticMarkup(React.createElement(reactApp.UploadPage, uploadPropsWithStorage));

  // Dropdown should be locked/unable to select and show Edit Logo button:
  ok(htmlWithStorage.includes('Lee, Mandy MY'), 'renders saved admin name from localStorage');
  ok(htmlWithStorage.includes('cursor-not-allowed') && htmlWithStorage.includes('opacity-80'), 'dropdown trigger has locked/disabled styling');
  ok(htmlWithStorage.includes('>Edit</span>') || htmlWithStorage.includes('title="Edit Process Admin"'), 'renders Edit Logo button next to dropdown');

  // Remove admin (no data)
  reactApp.saveProcessAdmin('');
  eq(mockStorage['processadmin'], undefined, 'saveProcessAdmin("") removes "processadmin" from localStorage');
  eq(reactApp.getSavedProcessAdmin(), '', 'getSavedProcessAdmin returns empty after removal');

  // Render UploadPage with no data in localStorage:
  const uploadPropsNoStorage = Object.assign({}, uploadPropsDisabled, {
    fields: reactApp.initialFormState(false),
  });
  const htmlNoStorage = renderToStaticMarkup(React.createElement(reactApp.UploadPage, uploadPropsNoStorage));
  ok(!htmlNoStorage.includes('title="Edit Process Admin"'), 'does not render Edit button when processadmin has no data');
  ok(!htmlNoStorage.includes('>Edit</span>'), 'no Edit button text when processadmin has no data');

  // Test buildLisStartPayload fallback to processadmin when issueBy is not set:
  const startPayloadWithProcessAdmin = buildLisStartPayload(
    {
      handledBy: { value: 'Mandy Lee' },
      iptUnitMgr: { value: 'Networking' },
      processadmin: { value: 'Lee, Mandy MY' },
    },
    'REC-PA-001',
    'UID-PA-001',
    'BTB'
  );
  eq(startPayloadWithProcessAdmin.admin_issuex0020by, 'Lee, Mandy MY', 'buildLisStartPayload falls back to processadmin when issueBy is omitted');

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
})();
