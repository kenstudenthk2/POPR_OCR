const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.resolve(__dirname, '../../Master page_21-Sep-2026.html'), 'utf8');
const appleHtml = fs.readFileSync(path.resolve(__dirname, '../../Master page_21-Sep-2026(Apple).html'), 'utf8');
const handler = html.match(/async function sendPRApprovalRequest\(\) \{[\s\S]*?\n\}\s*(?=function sendApprovalRequest)/);

async function run() {
    assert.ok(/id="btn-send-pr-approval"\s+onclick="sendPRApprovalRequest\(\)"/.test(html), 'Standard page button calls PR handler');
    assert.ok(!appleHtml.includes('sendPRApprovalRequest'), 'Apple page has no added PR handler');
    assert.ok(handler, 'PR approval handler exists');
    const requests = [];
    const notices = [];
    const button = { disabled: false };
    let confirmed = true;
    let finishRequest;
    const context = vm.createContext({
        state: { currentRecord: { Title: 'PR-123', Id: 'must-not-send', UMVerified: true } },
        document: { getElementById: () => button },
        confirm: () => confirmed,
        showToast: (message, type) => notices.push({ message, type }),
        console: { error() {} },
        fetch: (url, options) => {
            requests.push({ url, options });
            return new Promise(resolve => { finishRequest = resolve; });
        }
    });
    vm.runInContext(handler[0], context);
    const pending = context.sendPRApprovalRequest();
    assert.equal(button.disabled, true);
    await context.sendPRApprovalRequest();
    assert.equal(requests.length, 1, 'duplicate click does not submit again');
    assert.equal(requests[0].url, 'https://d1u4t2v5sfu1y7.cloudfront.net/webhook-test/6659f137-78a5-49ac-88b3-9c6882cb80d0');
    assert.equal(requests[0].options.method, 'POST');
    assert.equal(requests[0].options.headers['Content-Type'], 'application/json');
    assert.deepEqual(JSON.parse(requests[0].options.body), { Title: 'PR-123' });
    finishRequest({ ok: true });
    await pending;
    assert.equal(button.disabled, false);
    assert.equal(notices.at(-1).type, 'success');

    confirmed = false;
    await context.sendPRApprovalRequest();
    assert.equal(requests.length, 1);
    confirmed = true;
    for (const record of [null, {}, { Title: '   ' }]) {
        context.state.currentRecord = record;
        await context.sendPRApprovalRequest();
        assert.equal(requests.length, 1, 'missing title must not submit');
        assert.equal(notices.at(-1).type, 'warning');
    }

    context.state.currentRecord = { Title: 'PR-456' };
    const failed = context.sendPRApprovalRequest();
    finishRequest({ ok: false });
    await failed;
    assert.equal(button.disabled, false);
    assert.equal(notices.at(-1).type, 'error');
    context.fetch = async () => { throw new Error('Network unavailable'); };
    await context.sendPRApprovalRequest();
    assert.equal(button.disabled, false);
    assert.equal(notices.at(-1).type, 'error');
    assert.ok(html.includes('https://d1u4t2v5sfu1y7.cloudfront.net/webhook/um-approval-request'));
    console.log('PASS Standard PR approval webhook: payload, duplicate clicks, cancellation, validation, failures, and Apple-page isolation');
}

run().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
