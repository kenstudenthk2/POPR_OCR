const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const Babel = require('@babel/standalone');
const Module = require('module');

const source = fs.readFileSync(path.join(__dirname, '../../PR Assistant App.html'), 'utf8');
assert.match(source, /SIDE === "dev"\s*&&\s*<button[^>]*Guided tour/s, 'only the Dev sidebar offers the tour');
assert.match(source, /const GUIDED_TOUR_STEPS\s*=\s*\[/, 'tour steps exist');
for (const label of ['Process Admin', 'Upload documents', 'Select an item', 'Start processing', 'Verify Table', 'Select extra documents', 'Save to master', 'Review summary', 'Excel View', 'Another item', 'Master Records']) {
  assert(source.includes(`title: "${label}"`), `tour explains ${label}`);
}
assert.match(source, /data-tour=\{item\.key\}/, 'workflow navigation is available for spotlighting');
assert.match(source, /aria-label="Guided tour"/, 'tour has an accessible label');
assert.match(source, /Exit tour/);
assert.match(source, /Back/);
assert.match(source, /Finish/);
const tourSource = source.slice(source.indexOf('const GUIDED_TOUR_STEPS = ['), source.indexOf('\nfunction ', source.indexOf('function GuidedTour(') + 1));
const compiled = Babel.transform(tourSource + '\nglobalThis.tour = { GuidedTour, GUIDED_TOUR_STEPS };', { presets: [['react', { runtime: 'classic' }]] }).code;
const context = { React, ...React };
vm.runInNewContext(compiled, context);
const html = renderToStaticMarkup(React.createElement(context.tour.GuidedTour, { index: 0, onChange() {}, onClose() {} }));
assert(html.includes('STEP 1 OF 11') && html.includes('Process Admin') && html.includes('Exit tour'), 'first step renders with navigation');
assert.deepStrictEqual(Array.from(context.tour.GUIDED_TOUR_STEPS, s => s.page), ['upload', 'upload', 'upload', 'upload', 'extracted', 'lis', 'documents', 'lis', 'lis', 'lis', 'lis']);
assert(source.includes('tourOpen && <div className={sidebarCollapsed'), 'the tour mounts a separate example workflow');
assert(source.includes('tourPreview={true}'), 'example pages are explicitly marked as previews');
assert(source.includes('if (tourPreview) return;'), 'preview effects do not access Dataverse');
assert(source.includes('style={{ display: tourOpen ? "none" : undefined }}'), 'the actual page remains mounted while the tour is open');
const harnessPath = path.join(__dirname, 'app.js');
const harness = new Module(harnessPath, module);
harness.filename = harnessPath;
harness.paths = module.paths;
harness._compile(fs.readFileSync(harnessPath, 'utf8').replace('const EXPORTS = [', "const EXPORTS = ['TourPreview',"), harnessPath);
const app = harness.exports.load({ react: true, side: 'dev' });
for (let i = 0; i < context.tour.GUIDED_TOUR_STEPS.length; i++) {
  const preview = renderToStaticMarkup(React.createElement(app.TourPreview, { index: i }));
  const title = i < 4 ? 'Document Workbench' : i === 4 ? 'Verify Table' : i === 6 ? 'Select Documents to Pass' : 'LIS &amp; Remark';
  assert(preview.includes(title), `step ${i + 1} shows ${title}`);
  const target = context.tour.GUIDED_TOUR_STEPS[i].target;
  if (target) assert(preview.includes(`data-tour="${target}"`), `step ${i + 1} highlights a visible control`);
  if (target === 'excel-view') assert(preview.includes('Manage Columns') && preview.includes('Close Excel View'), 'Excel View step shows example controls');
  if (target === 'excel-preview') assert(preview.includes('ABC Company') && preview.includes('Contract-signed.pdf'), 'summary step shows example values and documents');
}
console.log('Guided tour checks passed');
