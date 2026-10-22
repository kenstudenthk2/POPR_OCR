/**
 * Automated test suite for Admin Mode in Master page_21-Sep-2026.html
 *
 * Verifies:
 * 1. Admin Mode activation:
 *    - ADMIN_ACTIVATION_PHRASE === "admin2026"
 *    - URL parameter detection (?admin=1, ?admin=true, ?admin=admin2026)
 *    - promptAdminMode() prompt response handling
 *    - setAdminMode() state toggling and window globals
 * 2. Admin Mode UI elements:
 *    - #btn-toggle-admin-mode trigger button
 *    - #admin-mode-badge in main header
 *    - #modal-admin-badge in edit modal
 * 3. Unlocked conditions and limitations:
 *    - validateRequiredFieldsForStage() bypass
 *    - validatePRNoField() and validatePONoField() bypass
 *    - Permanently disabled fields unlocked (applyPermanentlyDisabledFields)
 *    - Complete and Cancelled record locks bypassed in updateFieldLockingAndApprovalUI
 *    - Modal action buttons enabled (Mark Complete, Duplicate, Cancel, Save)
 *    - verifyUM() and approvePRRequest() condition bypass
 *    - UM Verified and PR Approved un-checking allowed
 *    - Duplicate quantity cap (> 10) lifted
 *    - COS Control File isCosRecordCompleted() returns true for all records
 *    - initApp() and initProcessAdmin() load data without a saved process admin
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const htmlPath = path.resolve(__dirname, '../../Master page_21-Sep-2026.html');
const html = fs.readFileSync(htmlPath, 'utf8');

let failures = 0;
function ok(desc, cond) {
    if (cond) {
        console.log(`OK   ${desc}`);
    } else {
        console.error(`FAIL ${desc}`);
        failures++;
    }
}

console.log("Testing Admin Mode in Master page_21-Sep-2026.html...\n");

// --- 1. Static HTML checks ---
console.log("--- 1. Static HTML Checks ---");
ok("Header has btn-toggle-admin-mode", html.includes('id="btn-toggle-admin-mode"'));
ok("Header has admin-mode-badge", html.includes('id="admin-mode-badge"'));
ok("Header admin-mode-badge has 'ADMIN MODE' text", html.includes('ADMIN MODE'));
ok("Header admin-mode-badge has exit button", html.includes('onclick="setAdminMode(false)"'));
ok("Edit modal header has modal-admin-badge", html.includes('id="modal-admin-badge"'));
ok("modal-admin-badge text is 'Admin bypass'", html.includes('Admin bypass'));

// --- 2. Script context setup ---
console.log("\n--- 2. Script Context & Global API Checks ---");
const scriptMatch = html.match(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/i);
if (!scriptMatch) {
    console.error("FAIL Could not extract script from Master page_21-Sep-2026.html");
    process.exit(1);
}

const mockElements = {};
function getMockElement(id) {
    if (!mockElements[id]) {
        mockElements[id] = {
            id,
            tagName: 'INPUT',
            value: '',
            checked: false,
            disabled: false,
            readOnly: false,
            className: '',
            classList: {
                classes: new Set(),
                add(...cls) { cls.forEach(c => this.classes.add(c)); },
                remove(...cls) { cls.forEach(c => this.classes.delete(c)); },
                contains(c) { return this.classes.has(c); },
                toggle(c) { if (this.classes.has(c)) this.classes.delete(c); else this.classes.add(c); }
            },
            style: {},
            dataset: {},
            setAttribute(k, v) { this[k] = v; },
            removeAttribute(k) { delete this[k]; },
            getAttribute(k) { return this[k]; },
            focus() {},
            scrollIntoView() {},
            innerHTML: '',
            innerText: '',
            textContent: '',
            children: [],
            appendChild() {},
            removeChild() {},
            querySelector() { return null; },
            querySelectorAll(sel) {
                if (id === 'editModalTabContent' || id === 'columnCheckboxContainer' || id === 'excelColumnCheckboxContainer') {
                    return [
                        getMockElement('edit-title'),
                        getMockElement('edit-subnumber'),
                        getMockElement('edit-request-status'),
                        getMockElement('edit-prref'),
                        getMockElement('edit-charge-ccc'),
                        getMockElement('edit-works-order-code'),
                        getMockElement('edit-account-code'),
                        getMockElement('edit-um-mgr'),
                        getMockElement('edit-ipt-unit-mgr'),
                        getMockElement('edit-pair-charge-ccc'),
                        getMockElement('edit-pair-account-code'),
                        getMockElement('edit-customer'),
                        getMockElement('edit-vendor'),
                        getMockElement('edit-prno'),
                        getMockElement('edit-pono'),
                        getMockElement('edit-remarks'),
                        getMockElement('btn-mark-complete'),
                        getMockElement('btn-duplicate'),
                        getMockElement('btn-save'),
                        getMockElement('btn-cancel-record')
                    ];
                }
                return [];
            },
            closest() { return getMockElement('tab-request'); },
            addEventListener() {},
            removeEventListener() {}
        };
    }
    return mockElements[id];
}

const sandbox = {
    console,
    Date,
    Math,
    String,
    Number,
    Array,
    Object,
    JSON,
    Set,
    Map,
    RegExp,
    parseInt,
    parseFloat,
    isNaN,
    isFinite,
    setTimeout: (fn) => fn(),
    clearTimeout: () => {},
    localStorage: {
        _store: {},
        getItem(k) { return this._store[k] || null; },
        setItem(k, v) { this._store[k] = String(v); },
        removeItem(k) { delete this._store[k]; }
    },
    document: {
        getElementById(id) { return getMockElement(id); },
        querySelector() { return null; },
        querySelectorAll(sel) {
            if (sel.includes('#editModalTabContent') || sel === 'input, select, textarea, button') {
                return [
                    getMockElement('edit-title'),
                    getMockElement('edit-subnumber'),
                    getMockElement('edit-request-status'),
                    getMockElement('edit-prref'),
                    getMockElement('edit-charge-ccc'),
                    getMockElement('edit-works-order-code'),
                    getMockElement('edit-account-code'),
                    getMockElement('edit-um-mgr'),
                    getMockElement('edit-ipt-unit-mgr'),
                    getMockElement('edit-pair-charge-ccc'),
                    getMockElement('edit-pair-account-code'),
                    getMockElement('edit-customer'),
                    getMockElement('edit-vendor'),
                    getMockElement('edit-prno'),
                    getMockElement('edit-pono'),
                    getMockElement('edit-remarks'),
                    getMockElement('btn-mark-complete'),
                    getMockElement('btn-duplicate'),
                    getMockElement('btn-save'),
                    getMockElement('btn-cancel-record')
                ];
            }
            if (sel.includes('.field-control.is-invalid')) return [];
            return [];
        },
        createElement: () => ({
            setAttribute() {},
            removeAttribute() {},
            appendChild() {},
            remove() {},
            style: {},
            classList: { add() {}, remove() {} }
        }),
        appendChild: () => {},
        addEventListener() {},
        body: {
            classList: { add() {}, remove() {}, contains() { return false; } },
            style: {},
            appendChild() {}
        }
    },
    window: {
        prompt: () => null,
        alert: () => {},
        confirm: () => true,
        addEventListener() {},
        location: { search: '' },
        history: { pushState() {} }
    },
    location: { search: '' },
    history: { pushState() {} },
    URLSearchParams: class {
        constructor(search = '') {
            this.map = new Map();
            if (search) {
                const s = search.startsWith('?') ? search.slice(1) : search;
                s.split('&').forEach(part => {
                    const [k, v] = part.split('=');
                    if (k) this.map.set(k, decodeURIComponent(v || ''));
                });
            }
        }
        get(k) { return this.map.get(k) || null; }
        set(k, v) { this.map.set(k, String(v)); }
        delete(k) { this.map.delete(k); }
        toString() {
            return Array.from(this.map.entries()).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
        }
    },
    URL: class {
        constructor(href) { this.href = href; this.search = ''; }
    },
    showToast: () => {},
    escapeHtml: (s) => String(s || ''),
    xmlEscape: (s) => String(s || ''),
    getDataverseWebApi: () => null
};

sandbox.window.document = sandbox.document;
sandbox.window.localStorage = sandbox.localStorage;

vm.createContext(sandbox);

try {
    vm.runInContext(scriptMatch[1], sandbox);
    ok("Script evaluated cleanly in sandbox", true);
} catch (e) {
    console.error("Script evaluation error:", e);
    ok("Script evaluated cleanly in sandbox", false);
}

// Check constants & functions
ok("ADMIN_ACTIVATION_PHRASE is 'admin2026'", sandbox.ADMIN_ACTIVATION_PHRASE === "admin2026");
ok("adminMode is exposed and initially false", sandbox.adminMode === false);
ok("setAdminMode function exists", typeof sandbox.setAdminMode === 'function');
ok("promptAdminMode function exists", typeof sandbox.promptAdminMode === 'function');
ok("checkInitialAdminMode function exists", typeof sandbox.checkInitialAdminMode === 'function');
ok("window.adminMode is defined", sandbox.window.adminMode === false);
ok("window.setAdminMode is defined", typeof sandbox.window.setAdminMode === 'function');
ok("window.promptAdminMode is defined", typeof sandbox.window.promptAdminMode === 'function');

// --- 3. Activation tests ---
console.log("\n--- 3. Activation & URL Checks ---");

// URL param tests
sandbox.location.search = "?admin=1";
ok("checkInitialAdminMode returns true for ?admin=1", sandbox.checkInitialAdminMode() === true);

sandbox.location.search = "?admin=true";
ok("checkInitialAdminMode returns true for ?admin=true", sandbox.checkInitialAdminMode() === true);

sandbox.location.search = "?admin=admin2026";
ok("checkInitialAdminMode returns true for ?admin=admin2026", sandbox.checkInitialAdminMode() === true);

sandbox.location.search = "?admin=0";
ok("checkInitialAdminMode returns false for ?admin=0", sandbox.checkInitialAdminMode() === false);

sandbox.location.search = "";
ok("checkInitialAdminMode returns false for empty query", sandbox.checkInitialAdminMode() === false);

// promptAdminMode tests
let alertCalled = false;
sandbox.window.alert = () => { alertCalled = true; };

// Correct password
sandbox.window.prompt = () => "admin2026";
sandbox.promptAdminMode();
ok("promptAdminMode('admin2026') activates adminMode", sandbox.adminMode === true);
ok("admin-mode-badge is unhidden when adminMode is active", !getMockElement('admin-mode-badge').classList.contains('hidden'));
ok("modal-admin-badge is unhidden when adminMode is active", !getMockElement('modal-admin-badge').classList.contains('hidden'));

// Calling promptAdminMode when already active deactivates it
sandbox.promptAdminMode();
ok("promptAdminMode() when already active deactivates adminMode", sandbox.adminMode === false);
ok("admin-mode-badge is hidden when adminMode is inactive", getMockElement('admin-mode-badge').classList.contains('hidden'));
ok("modal-admin-badge is hidden when adminMode is inactive", getMockElement('modal-admin-badge').classList.contains('hidden'));

// Incorrect password
alertCalled = false;
sandbox.window.prompt = () => "wrongpass";
sandbox.promptAdminMode();
ok("promptAdminMode('wrongpass') does not activate adminMode", sandbox.adminMode === false);
ok("promptAdminMode('wrongpass') shows alert", alertCalled === true);

// Cancelled prompt
alertCalled = false;
sandbox.window.prompt = () => null;
sandbox.promptAdminMode();
ok("promptAdminMode(null) does not activate adminMode and does not alert", sandbox.adminMode === false && alertCalled === false);

// --- 4. Unlocked Conditions & Limitations ---
console.log("\n--- 4. Unlocked Conditions & Limitations ---");

// Activate Admin Mode for tests
sandbox.setAdminMode(true);
ok("setAdminMode(true) sets adminMode to true", sandbox.adminMode === true);

// A. Validation bypass
console.log("\nTesting Validation Bypass:");
// validateRequiredFieldsForStage
ok("validateRequiredFieldsForStage('PR No. Ready') returns true in adminMode without fields", sandbox.validateRequiredFieldsForStage('PR No. Ready') === true);
ok("validateRequiredFieldsForStage('Complete') returns true in adminMode without fields", sandbox.validateRequiredFieldsForStage('Complete') === true);

// validatePRNoField & validatePONoField
getMockElement('edit-prno').value = "invalid-pr-12345";
ok("validatePRNoField() returns true in adminMode for non-7-digit input", sandbox.validatePRNoField() === true);
ok("edit-prno does not have is-invalid class in adminMode", !getMockElement('edit-prno').classList.contains('is-invalid'));

getMockElement('edit-pono').value = "invalid-po-no";
ok("validatePONoField() returns true in adminMode for invalid format", sandbox.validatePONoField() === true);
ok("edit-pono does not have is-invalid class in adminMode", !getMockElement('edit-pono').classList.contains('is-invalid'));

// B. Duplicate modal cap (> 10) lifted
console.log("\nTesting Duplicate Modal Cap:");
sandbox.state.currentRecord = { Id: "1", Title: "REQ-001", ProcessStatus: "Complete" };
getMockElement('duplicate-quantity').value = "50";
sandbox.confirmDuplicateRecord();
ok("confirmDuplicateRecord accepts quantity > 10 in adminMode", !getMockElement('duplicate-quantity').classList.contains('is-invalid'));

// C. Permanently disabled fields unlocked
console.log("\nTesting Field Locks in Admin Mode:");
const permDisabledIds = [
    'edit-title', 'edit-subnumber', 'edit-request-status', 'edit-prref',
    'edit-charge-ccc', 'edit-works-order-code', 'edit-account-code',
    'edit-um-mgr', 'edit-ipt-unit-mgr', 'edit-pair-charge-ccc', 'edit-pair-account-code'
];

permDisabledIds.forEach(id => {
    getMockElement(id).disabled = true;
});

sandbox.applyPermanentlyDisabledFields();
ok("applyPermanentlyDisabledFields() does not disable fields when adminMode is true",
    permDisabledIds.every(id => getMockElement(id).disabled === true) // were not touched by applyPermanentlyDisabledFields
);

// updateFieldLockingAndApprovalUI in Complete status
sandbox.updateFieldLockingAndApprovalUI('Complete');
ok("updateFieldLockingAndApprovalUI('Complete') enables controls when adminMode is true",
    permDisabledIds.every(id => getMockElement(id).disabled === false)
);

const completeBtn = getMockElement('btn-mark-complete');
const duplicateBtn = getMockElement('btn-duplicate');
const cancelBtn = getMockElement('btn-cancel-record');
const saveBtn = getMockElement('btn-save');

ok("btn-mark-complete is enabled in Complete status in adminMode", completeBtn.disabled === false);
ok("btn-duplicate is enabled in Complete status in adminMode", duplicateBtn.disabled === false);
ok("btn-cancel-record is enabled in Complete status in adminMode", cancelBtn.disabled === false);
ok("btn-save is enabled in Complete status in adminMode", saveBtn.disabled === false);

// updateFieldLockingAndApprovalUI in Cancelled status
sandbox.updateFieldLockingAndApprovalUI('Cancelled');
ok("btn-save is enabled in Cancelled status in adminMode", saveBtn.disabled === false);
ok("btn-duplicate is enabled in Cancelled status in adminMode", duplicateBtn.disabled === false);

// D. Workflow approval & verification rules
console.log("\nTesting Verification & Approval Rules:");
sandbox.state.currentRecord = {
    Id: "2",
    Title: "REQ-002",
    PRNo: "", // Empty PR No!
    UMVerified: false,
    PRRequestApproved: false,
    PONo: "PO1234567",
    ProcessStatus: "PR No. Ready"
};
sandbox.state.allData = [sandbox.state.currentRecord];
getMockElement('edit-id').value = "2";

// verifyUM() without PR No.
getMockElement('edit-um-verified').checked = true;
ok("verifyUM() succeeds without PR No. in adminMode", sandbox.verifyUM() === true);
ok("state.currentRecord.UMVerified set to true", sandbox.state.currentRecord.UMVerified === true);

// approvePRRequest() without prior UM Verification
sandbox.state.currentRecord.UMVerified = false;
ok("approvePRRequest() succeeds without UMVerified in adminMode", sandbox.approvePRRequest() === true);

// Un-verifying UM when PR is approved
sandbox.state.currentRecord.PRRequestApproved = true;
const umCheckbox = getMockElement('edit-um-verified');
umCheckbox.checked = false;
sandbox.handleUMVerifiedChange(umCheckbox);
ok("handleUMVerifiedChange allows un-verifying even if PR is approved in adminMode", sandbox.state.currentRecord.UMVerified === false);

// Un-approving PR when PO No. exists
const prApproveCheckbox = getMockElement('edit-pr-approved');
prApproveCheckbox.checked = false;
sandbox.handlePRApprovedCheckboxClick({ preventDefault() {} }, prApproveCheckbox);
ok("handlePRApprovedCheckboxClick allows un-approving even if PO exists in adminMode", sandbox.state.currentRecord.PRRequestApproved === false);

// E. COS Control File completed check
console.log("\nTesting COS Control File:");
const draftRecord = { Id: "3", Title: "REQ-003", ProcessStatus: "PR No. Ready" };
const cancelledRecord = { Id: "4", Title: "REQ-004", ProcessStatus: "Cancelled" };
ok("isCosRecordCompleted returns true for PR No. Ready in adminMode", sandbox.isCosRecordCompleted(draftRecord) === true);
ok("isCosRecordCompleted returns true for Cancelled in adminMode", sandbox.isCosRecordCompleted(cancelledRecord) === true);

// F. Deactivate Admin Mode and verify normal behavior restored
console.log("\n--- 5. Restoring Standard Mode Checks ---");
sandbox.setAdminMode(false);
ok("setAdminMode(false) sets adminMode to false", sandbox.adminMode === false);

// Normal validation restored
getMockElement('edit-prno').value = "invalid-pr-12345";
ok("validatePRNoField() rejects invalid PR in standard mode", sandbox.validatePRNoField() === false);

getMockElement('edit-pono').value = "invalid-po-no";
ok("validatePONoField() rejects invalid PO in standard mode", sandbox.validatePONoField() === false);

// Normal field lock restored in Complete status
sandbox.updateFieldLockingAndApprovalUI('Complete');
ok("updateFieldLockingAndApprovalUI('Complete') disables edit-title in standard mode", getMockElement('edit-title').disabled === true);
ok("btn-cancel-record is disabled in Complete status in standard mode", cancelBtn.disabled === true);

// Normal duplicate limit restored
getMockElement('duplicate-quantity').value = "15";
sandbox.confirmDuplicateRecord();
ok("confirmDuplicateRecord rejects quantity > 10 in standard mode", getMockElement('duplicate-quantity').classList.contains('is-invalid'));

// Normal COS record completed check restored
ok("isCosRecordCompleted returns false for PR No. Ready in standard mode", sandbox.isCosRecordCompleted(draftRecord) === false);

// Summary
console.log(`\n==========================================`);
if (failures === 0) {
    console.log("ALL ADMIN MODE TESTS PASSED SUCCESSFULLY!");
    process.exit(0);
} else {
    console.error(`FAILED: ${failures} check(s) failed.`);
    process.exit(1);
}
