const fs = require('fs');
const path = require('path');
const vm = require('vm');

const masterPagePath = path.resolve(__dirname, '../../Master page_21-Sep-2026.html');
const html = fs.readFileSync(masterPagePath, 'utf8');

function assert(cond, msg) {
    if (!cond) {
        console.error("FAIL: " + msg);
        process.exit(1);
    }
    console.log("OK   " + msg);
}

// 1. Static HTML Checks
console.log("--- 1. Static HTML Checks ---");
assert(html.includes('id="columnModal"'), "columnModal exists in HTML");
assert(html.includes('id="columnCheckboxContainer"'), "columnCheckboxContainer exists in HTML");
assert(html.includes('id="columnVisibleCount"'), "columnVisibleCount exists in HTML");
assert(html.includes('id="columnTotalCount"'), "columnTotalCount exists in HTML");
assert(html.includes('Locked columns (Action, Record ID) are always visible'), "Modal footer explains locked Action and Record ID and numbering");

// 2. Script Context Setup
console.log("\n--- 2. Script Context & Global API Checks ---");
const scriptMatch = html.match(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/i);
assert(Boolean(scriptMatch), "Found embedded script in Master page_21-Sep-2026.html");

const mockElements = {};
function getMockElement(id) {
    if (!mockElements[id]) {
        mockElements[id] = {
            id,
            tagName: 'DIV',
            value: '',
            checked: false,
            disabled: false,
            className: '',
            classList: {
                classes: new Set(),
                add(...cls) { cls.forEach(c => this.classes.add(c)); },
                remove(...cls) { cls.forEach(c => this.classes.delete(c)); },
                contains(c) { return this.classes.has(c); }
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
            appendChild() {},
            removeChild() {},
            querySelector(sel) {
                // Return mock select/checkbox if queried
                if (sel.includes('select')) {
                    return { value: '', dataset: { key: 'CustomerName' }, className: '' };
                }
                return null;
            },
            querySelectorAll(sel) {
                return [];
            }
        };
    }
    return mockElements[id];
}

const mockLocalStorage = {
    _data: {},
    getItem(k) { return this._data[k] || null; },
    setItem(k, v) { this._data[k] = String(v); },
    removeItem(k) { delete this._data[k]; },
    clear() { this._data = {}; }
};

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
    localStorage: mockLocalStorage,
    document: {
        getElementById: (id) => getMockElement(id),
        querySelector: (sel) => {
            if (sel === 'table thead') return getMockElement('mainRecordsTableHead');
            return null;
        },
        querySelectorAll: () => [],
        addEventListener: () => {},
        removeEventListener: () => {},
        createElement: (tag) => {
            return {
                tagName: tag.toUpperCase(),
                className: '',
                classList: {
                    add() {},
                    remove() {}
                },
                appendChild(child) {
                    if (!this.children) this.children = [];
                    this.children.push(child);
                },
                remove() {},
                children: [],
                innerHTML: '',
                textContent: '',
                style: {},
                setAttribute(k, v) { this[k] = v; }
            };
        }
    },
    window: {
        location: { search: '' },
        prompt: () => null,
        alert: () => {},
        showToast: () => {}
    },
    showToast: () => {},
    escapeHtml: (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
    getStatusBadge: () => '<span>Status</span>'
};

const scriptCode = scriptMatch[1] + `
;EXPORTS = {
    COLUMN_CONFIG,
    getVisibleColumns,
    normalizeColumnOrders,
    loadColumnPreferences,
    saveColumnPreferences,
    handleColumnSelectDropdownChange,
    handleColumnCardClick,
    toggleAllColumns,
    openColumnModal,
    closeColumnModal,
    updateColumnModalCounts,
    renderTableHeader,
    state
};
`;

vm.createContext(sandbox);
vm.runInContext(scriptCode, sandbox);
const X = sandbox.EXPORTS;

console.log("\n--- 3. Column Configuration Specification Checks ---");
// Requirement 2: The First column change to always visible "Action" column
assert(X.COLUMN_CONFIG[0].key === 'Actions', "1st item in COLUMN_CONFIG is Actions");
assert(X.COLUMN_CONFIG[0].locked === true, "1st column (Action) is locked (always visible)");
assert(X.COLUMN_CONFIG[0].visible === true, "1st column (Action) is visible: true");

// Requirement 3: The 2nd column always visible "Record ID" column
assert(X.COLUMN_CONFIG[1].key === 'Title', "2nd item in COLUMN_CONFIG is Title (Record ID)");
assert(X.COLUMN_CONFIG[1].locked === true, "2nd column (Record ID) is locked (always visible)");
assert(X.COLUMN_CONFIG[1].visible === true, "2nd column (Record ID) is visible: true");

// Requirement 1: "SB Report Generated" no need always visible, let user select or unselect
const sbCol = X.COLUMN_CONFIG.find(c => c.key === 'SBReportGenerated');
assert(Boolean(sbCol), "COLUMN_CONFIG contains SBReportGenerated");
assert(!sbCol.locked, "SBReportGenerated does NOT have locked: true (user can select/unselect)");

// Requirement 4: getVisibleColumns returns Action first, Record ID second, then numbered columns in order
console.log("\n--- 4. getVisibleColumns Ordering Checks ---");
const visibleCols = X.getVisibleColumns();
assert(visibleCols[0].key === 'Actions', "1st column in table is Action");
assert(visibleCols[1].key === 'Title', "2nd column in table is Record ID");
assert(visibleCols[2].order === 1, "3rd column in table has order 1 (1st column after Record ID)");
assert(visibleCols[3].order === 2, "4th column in table has order 2 (2nd column after Record ID)");

// Check reordering behavior
console.log("\n--- 5. Dynamic Reordering & Select Logic Checks ---");
// Change Vendor (currently order 3) to 1
X.handleColumnSelectDropdownChange('Vendor', '1');
const reordered = X.getVisibleColumns();
assert(reordered[0].key === 'Actions', "Action stays 1st after reorder");
assert(reordered[1].key === 'Title', "Record ID stays 2nd after reorder");
assert(reordered[2].key === 'Vendor', "Vendor is now order 1 (1st column after Record ID)");
assert(reordered[2].order === 1, "Vendor order is 1");

// Unselect a column
X.handleColumnSelectDropdownChange('Vendor', '0'); // unselect
const afterUnselect = X.getVisibleColumns();
assert(!afterUnselect.find(c => c.key === 'Vendor'), "Vendor is no longer in visible columns");
assert(afterUnselect[2].order === 1, "Next column was shifted to order 1 without gaps");

// Card click toggle
const customerAddressCol = X.COLUMN_CONFIG.find(c => c.key === 'CustomerAddress');
assert(!customerAddressCol.visible, "CustomerAddress starts unselected");
X.handleColumnCardClick(null, 'CustomerAddress');
assert(customerAddressCol.visible === true, "Clicking card selects CustomerAddress");
assert(customerAddressCol.order > 0, "Clicking card assigns valid positive order");

// Click again to unselect
X.handleColumnCardClick(null, 'CustomerAddress');
assert(!customerAddressCol.visible, "Clicking card again unselects CustomerAddress");
assert(customerAddressCol.order === 0, "Unselected CustomerAddress order is 0");

// Persistence check with save and load
console.log("\n--- 6. Persistence & Legacy Compatibility Checks ---");
X.handleColumnSelectDropdownChange('CustomerName', '1');
X.handleColumnSelectDropdownChange('Vendor', '2');
X.saveColumnPreferences();

const savedRaw = mockLocalStorage.getItem('master_list_column_config');
assert(Boolean(savedRaw), "saveColumnPreferences wrote to localStorage");
const savedParsed = JSON.parse(savedRaw);
assert(savedParsed.CustomerName === 1, "CustomerName saved with order 1");
assert(savedParsed.Vendor === 2, "Vendor saved with order 2");

// Test legacy boolean format in localStorage
mockLocalStorage.setItem('master_list_column_config', JSON.stringify({
    SubNumber: true,
    CustomerEmailAddress: true,
    CustomerName: false
}));
X.loadColumnPreferences();
const subCol = X.COLUMN_CONFIG.find(c => c.key === 'SubNumber');
const emailCol = X.COLUMN_CONFIG.find(c => c.key === 'CustomerEmailAddress');
const custNameCol = X.COLUMN_CONFIG.find(c => c.key === 'CustomerName');
assert(subCol.visible === true, "Legacy boolean true loaded as visible: true");
assert(subCol.order > 0, "Legacy boolean true normalized to order > 0");
assert(emailCol.visible === true, "Legacy email boolean true loaded as visible: true");
assert(!custNameCol.visible, "Legacy false loaded as visible: false");

console.log("\nALL COLUMN ORDERING AND CUSTOMIZATION CHECKS PASSED!");
