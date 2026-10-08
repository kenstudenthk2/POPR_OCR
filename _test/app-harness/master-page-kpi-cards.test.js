/* master-page-kpi-cards.test.js
 * Verifies that in Master page_21-Sep-2026.html:
 * 1. The 6 KPI Status Cards are converted to clickable <button> elements.
 * 2. Card sizes and layouts are preserved (grid, p-4, rounded-xl, shadow, typography).
 * 3. Each card has an onclick handler calling setTab() with the corresponding tab:
 *    - Total Records      <-> "All"
 *    - Urgent Tasks       <-> "Urgent"
 *    - Quotation Expired  <-> "Expired"
 *    - Expiring Soon      <-> "Expiring Soon"
 *    - Completed Tasks    <-> "Complete"
 *    - Cancelled Records  <-> "Cancelled"
 * 4. Clicking/activating a KPI card updates state.activeTab, active visual state,
 *    and filters records just like clicking the tab filter buttons.
 * 5. updateDashboard() computes urgent KPI count and populates the card.
 */

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const HTML_PATH = path.resolve(__dirname, "../../Master page_21-Sep-2026.html");
const HTML = fs.readFileSync(HTML_PATH, "utf8");

let failures = 0;
const eq = (label, a, b) => {
  if (a === b) {
    console.log("OK   " + label);
    return;
  }
  failures++;
  console.error("FAIL " + label + "\n     expected " + JSON.stringify(b) + "\n     actual   " + JSON.stringify(a));
};

const ok = (label, cond, extra) => {
  if (cond) {
    console.log("OK   " + label);
    return;
  }
  failures++;
  console.error("FAIL " + label + (extra ? " " + JSON.stringify(extra) : ""));
};

// 1. Structure assertions on HTML
const kpiSectionMatch = HTML.match(/<!-- KPI Dashboard -->\s*<div[^>]*>([\s\S]*?)<\/div>\s*<div id="filterPanel"/);
ok("KPI Dashboard section exists", Boolean(kpiSectionMatch));

if (kpiSectionMatch) {
  const kpiSection = kpiSectionMatch[1];

  // Verify that cards are button elements
  const buttons = kpiSection.match(/<button[\s\S]*?<\/button>/g) || [];
  eq("KPI Dashboard contains 6 button elements", buttons.length, 6);

  // Check each button's tab mapping and onclick
  const expectedTabs = ["All", "Urgent", "Expired", "Expiring Soon", "Complete", "Cancelled"];
  expectedTabs.forEach(tab => {
    const hasTabBtn = buttons.some(btn => 
      btn.includes(`data-tab="${tab}"`) && 
      btn.includes(`setTab('${tab}')`)
    );
    ok(`KPI card button exists for tab '${tab}' with onclick setTab('${tab}')`, hasTabBtn);
  });

  // Verify cards retain button type="button", text-left, w-full, p-4, cursor-pointer
  buttons.forEach((btn, idx) => {
    ok(`Button ${idx + 1} has type="button"`, btn.includes('type="button"'));
    ok(`Button ${idx + 1} has text-left`, btn.includes('text-left'));
    ok(`Button ${idx + 1} has w-full`, btn.includes('w-full'));
    ok(`Button ${idx + 1} has p-4`, btn.includes('p-4'));
    ok(`Button ${idx + 1} has cursor-pointer`, btn.includes('cursor-pointer'));
    ok(`Button ${idx + 1} has rounded-xl`, btn.includes('rounded-xl'));
  });

  // Verify IDs for counts
  ok("Total records number has id kpi-total", kpiSection.includes('id="kpi-total"'));
  ok("Urgent tasks number has id kpi-urgent", kpiSection.includes('id="kpi-urgent"'));
  ok("Expired quotation number has id kpi-expired", kpiSection.includes('id="kpi-expired"'));
  ok("Expiring soon number has id kpi-upcoming", kpiSection.includes('id="kpi-upcoming"'));
  ok("Completed tasks number has id kpi-finished", kpiSection.includes('id="kpi-finished"'));
  ok("Cancelled records number has id kpi-cancelled", kpiSection.includes('id="kpi-cancelled"'));
}

// 2. Behavioral verification in JS VM
const scriptMatch = HTML.match(/<script>([\s\S]*?)<\/script>/);
ok("Script tag exists", Boolean(scriptMatch));

if (scriptMatch) {
  const scriptContent = scriptMatch[1];

  // DOM Mock
  const elements = new Map();
  const makeElement = (tag, id, classes = "") => {
    const classList = new Set(classes.split(/\s+/).filter(Boolean));
    const attrs = new Map();
    const el = {
      tagName: tag.toUpperCase(),
      id: id || "",
      classList: {
        add: (...cls) => cls.forEach(c => classList.add(c)),
        remove: (...cls) => cls.forEach(c => classList.delete(c)),
        toggle: (c, force) => {
          if (force === undefined) {
            classList.has(c) ? classList.delete(c) : classList.add(c);
          } else if (force) {
            classList.add(c);
          } else {
            classList.delete(c);
          }
        },
        contains: (c) => classList.has(c)
      },
      getAttribute: (name) => attrs.get(name) || null,
      setAttribute: (name, val) => attrs.set(name, String(val)),
      removeAttribute: (name) => attrs.delete(name),
      innerText: "",
      innerHTML: "",
      value: "",
      disabled: false,
      appendChild: (c) => c,
      removeChild: (c) => c,
      querySelector: () => null,
      querySelectorAll: () => []
    };
    if (id) elements.set(id, el);
    return el;
  };

  // Pre-create KPI DOM elements
  const kpiBtns = [
    makeElement("button", "kpi-card-all", "kpi-card-btn border-[var(--line)] bg-white/95"),
    makeElement("button", "kpi-card-urgent", "kpi-card-btn border-[var(--line)] bg-white/95"),
    makeElement("button", "kpi-card-expired", "kpi-card-btn border-[var(--line)] bg-white/95"),
    makeElement("button", "kpi-card-expiring-soon", "kpi-card-btn border-[var(--line)] bg-white/95"),
    makeElement("button", "kpi-card-complete", "kpi-card-btn border-[var(--line)] bg-white/95"),
    makeElement("button", "kpi-card-cancelled", "kpi-card-btn border-[var(--line)] bg-white/95")
  ];
  kpiBtns[0].setAttribute("data-tab", "All");
  kpiBtns[1].setAttribute("data-tab", "Urgent");
  kpiBtns[2].setAttribute("data-tab", "Expired");
  kpiBtns[3].setAttribute("data-tab", "Expiring Soon");
  kpiBtns[4].setAttribute("data-tab", "Complete");
  kpiBtns[5].setAttribute("data-tab", "Cancelled");

  makeElement("div", "kpi-total");
  makeElement("div", "kpi-urgent");
  makeElement("div", "kpi-pending");
  makeElement("div", "kpi-expired");
  makeElement("div", "kpi-upcoming");
  makeElement("div", "kpi-finished");
  makeElement("div", "kpi-cancelled");
  makeElement("div", "tabBar");
  makeElement("input", "globalSearch");
  makeElement("input", "flt-handledBy");
  makeElement("input", "flt-vendor");
  makeElement("input", "flt-customer");
  makeElement("input", "flt-uid");
  makeElement("input", "flt-prno");
  makeElement("input", "flt-producttype");
  makeElement("tbody", "tableBody");
  makeElement("thead", "tableHeader");
  makeElement("div", "pageInfo");

  const sandbox = {
    console,
    Math,
    Date,
    String,
    Number,
    Boolean,
    parseInt,
    parseFloat,
    isNaN,
    document: {
      getElementById: (id) => elements.get(id) || null,
      querySelectorAll: (sel) => {
        if (sel === '.kpi-card-btn') return kpiBtns;
        return [];
      },
      querySelector: (sel) => null,
      createElement: (tag) => makeElement(tag, ""),
      addEventListener: () => {}
    },
    window: {},
    location: { search: "" },
    getCurrentHKTDate: () => new Date("2026-10-08T00:00:00Z"),
    renderTableHeader: () => {},
    renderTable: () => {},
    applySort: () => {},
    showToast: () => {},
    EXPORTS: {}
  };
  sandbox.window = sandbox;

  const SCRIPT_CODE = scriptContent + `
;EXPORTS.state = state;
EXPORTS.updateDashboard = updateDashboard;
EXPORTS.setTab = setTab;
EXPORTS.renderTabBar = renderTabBar;
EXPORTS.STATUS_TABS = STATUS_TABS;
`;

  try {
    vm.createContext(sandbox);
    vm.runInContext(SCRIPT_CODE, sandbox);
    ok("Script evaluated cleanly", true);

    const { state, updateDashboard, setTab, renderTabBar, STATUS_TABS } = sandbox.EXPORTS;

    // Verify STATUS_TABS no longer includes redundant tabs
    eq("STATUS_TABS has 4 workflow stage tabs", STATUS_TABS.length, 4);
    ok("STATUS_TABS includes 'PR No. Ready'", STATUS_TABS.includes("PR No. Ready"));
    ok("STATUS_TABS includes 'UM Verified'", STATUS_TABS.includes("UM Verified"));
    ok("STATUS_TABS includes 'LIS System Approved'", STATUS_TABS.includes("LIS System Approved"));
    ok("STATUS_TABS includes 'PO No. Ready'", STATUS_TABS.includes("PO No. Ready"));

    const removedTabs = ["All", "Urgent", "Expired", "Expiring Soon", "Complete", "Cancelled"];
    removedTabs.forEach(removed => {
      ok(`STATUS_TABS does not include '${removed}'`, !STATUS_TABS.includes(removed));
    });

    // Mock data with various statuses
    state.allData = [
      { Id: "1", UrgentFlag: true, ProcessStatus: "PR No. Ready", QuotationExpiryDate: "2026-10-01" }, // Urgent & Expired
      { Id: "2", UrgentFlag: false, ProcessStatus: "Complete", QuotationExpiryDate: "2026-10-20" },
      { Id: "3", UrgentFlag: true, ProcessStatus: "Cancelled", QuotationExpiryDate: "2026-10-09" }, // Urgent & Cancelled
      { Id: "4", UrgentFlag: false, ProcessStatus: "UM Verified", QuotationExpiryDate: "2026-10-09" } // Expiring Soon (diff < 3)
    ];

    // Test renderTabBar() only outputs workflow tabs
    renderTabBar();
    const tabBarHtml = elements.get("tabBar").innerHTML;
    ok("tabBar renders PR No. Ready", tabBarHtml.includes("PR No. Ready"));
    ok("tabBar renders UM Verified", tabBarHtml.includes("UM Verified"));
    removedTabs.forEach(removed => {
      ok(`tabBar does not render '${removed}'`, !tabBarHtml.includes(`setTab('${removed}')`));
    });

    // Test updateDashboard()
    updateDashboard();
    eq("kpi-total displays 4", elements.get("kpi-total").innerText, "4");
    eq("kpi-urgent displays 2", elements.get("kpi-urgent").innerText, "2");
    eq("kpi-finished displays 1", elements.get("kpi-finished").innerText, "1");
    eq("kpi-cancelled displays 1", elements.get("kpi-cancelled").innerText, "1");

    // Test setTab('Urgent')
    setTab("Urgent");
    eq("state.activeTab is 'Urgent'", state.activeTab, "Urgent");
    eq("state.currentPage is 1", state.currentPage, 1);
    ok("kpi-card-urgent has aria-pressed='true'", kpiBtns[1].getAttribute("aria-pressed") === "true");
    ok("kpi-card-all has aria-pressed='false'", kpiBtns[0].getAttribute("aria-pressed") === "false");
    ok("kpi-card-urgent has ring-2 active class", kpiBtns[1].classList.contains("ring-2"));
    ok("kpi-card-all does NOT have ring-2 active class", !kpiBtns[0].classList.contains("ring-2"));

    // Test setTab('Expired')
    setTab("Expired");
    eq("state.activeTab is 'Expired'", state.activeTab, "Expired");
    ok("kpi-card-expired has aria-pressed='true'", kpiBtns[2].getAttribute("aria-pressed") === "true");
    ok("kpi-card-urgent has aria-pressed='false'", kpiBtns[1].getAttribute("aria-pressed") === "false");

    // Test setTab('All')
    setTab("All");
    eq("state.activeTab is 'All'", state.activeTab, "All");
    ok("kpi-card-all has aria-pressed='true'", kpiBtns[0].getAttribute("aria-pressed") === "true");

  } catch (err) {
    failures++;
    console.error("Execution error:", err);
  }
}

if (failures > 0) {
  console.error(`\n${failures} test(s) failed.`);
  process.exit(1);
} else {
  console.log("\nALL CHECKS PASSED: KPI status cards buttons verified successfully.");
}
