# Phase 0 — Worker 安全加固 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 堵住 `worker/worker.js` 当前作为无鉴权、无限流、无体积上限的公开 Gemini 代理的敞口,并在其之上设置预算兜底。

**Architecture:** 三层防护,由外到内独立生效 —— (1) Google Cloud 预算上限作为最终兜底;(2) Worker 内的请求体校验(体积、part 数、mime 白名单、文本长度)拒绝非文档解析用途的调用;(3) 按 IP 限流阻断批量滥用。Turnstile 作为可选的第四层,先做可行性验证再决定是否投入。校验逻辑抽成纯函数以便单元测试。

**Tech Stack:** Cloudflare Workers (ESM), wrangler CLI, vitest(仅用于 `worker/`,不影响 `Docparse/`)

## Global Constraints

- 仓库根目录:`C:\Users\user\Desktop\GitHub\OCR`。本文档中所有路径均相对此根目录。
- `Docparse/` 必须保持 **无构建、无安装、zip 分发、从 `file://` 打开**。禁止在 `Docparse/` 中引入 ES modules(`type="module"` 在 `file://` 下被 CORS 阻断)、打包器、或任何 npm 依赖。
- `Docparse/` 中任何**新增的必需文件**都必须同时加入 `missingLibs` 守卫(`Docparse/index.html:240-251`)和 `Docparse/README.md:14-19` 的文件表,否则手工只复制 `index.html` 的用户会得到静默损坏而非友好报错。本期不新增此类文件。
- Worker 的所有安全参数(limits、schema、generationConfig)必须**硬编码在服务端**,绝不接受客户端传入 —— 这是 `worker/worker.js:36-37` 现有注释明确声明的防开放代理设计,不得破坏。
- `Document/` 内为 HKT / PCCW / AIA 的真实商业合同(含价格、服务号、签名)。**任何情况下不得进入 git**。
- Gemini key 所在的 Google Cloud project 已确认绑定 billing account(付费层)。
- 所有 shell 命令按用户全局规范加 `rtk` 前缀。
- 每个 commit 必须以下列 trailer 结尾:
  ```
  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_015Jcn7hSXhFpRjXKVgqRPYU
  ```

## File Structure

| 文件 | 状态 | 职责 |
|---|---|---|
| `.gitignore` | 新建 | 排除 `Document/`、`node_modules/`、`.wrangler/`、scratch 文件 |
| `worker/limits.js` | 新建 | 纯函数:limits 常量 + `validateRequest(body)`。无 Workers runtime 依赖,可在 Node 下单测 |
| `worker/limits.test.js` | 新建 | `validateRequest()` 的单元测试 |
| `worker/package.json` | 新建 | 仅为引入 vitest;`Docparse/` 不受影响 |
| `worker/worker.js` | 修改 | 接入 `validateRequest`、原始体积检查、限流绑定 |
| `worker/wrangler.toml` | 修改 | 增加 ratelimit 绑定 |
| `scratch/turnstile-spike.html` | 新建(临时) | Turnstile `file://` 可行性验证页,验证后删除 |
| `Docparse/index.html` | 修改 | 移除死掉的用户自填 key 路径;修正 400/403 报错文案 |

---

### Task 0: 建立 git 基线并保护机密文档

**Files:**
- Create: `.gitignore`

**Interfaces:**
- Consumes: 无
- Produces: 一个干净的 git 仓库,后续每个 Task 都在其上提交

**为什么先做这个:** 本目录当前不是 git 仓库。后续要改 `Docparse/index.html`(1629 行)和安全相关代码,没有回滚能力风险过高。同时 `Document/` 里的真实合同一旦进入 git 历史就极难彻底清除,所以 `.gitignore` 必须在第一次 `git add` **之前**就位。

- [ ] **Step 1: 确认 rtk 可用**

```bash
rtk git --version
```

预期:输出 git 版本号。若命令不存在,后续所有步骤去掉 `rtk` 前缀直接用 `git`。

- [ ] **Step 2: 确认当前确实不是 git 仓库**

```bash
cd "C:/Users/user/Desktop/GitHub/OCR" && rtk git status
```

预期:报错 `not a git repository`。若它**已经是**仓库,跳过 Step 3,直接做 Step 4。

- [ ] **Step 3: 初始化仓库**

```bash
cd "C:/Users/user/Desktop/GitHub/OCR" && rtk git init
```

预期:`Initialized empty Git repository in .../OCR/.git/`

- [ ] **Step 4: 写 .gitignore**

创建 `.gitignore`,内容完全如下:

```gitignore
# 真实商业合同(HKT / PCCW / AIA),含价格、服务号与签名。
# 绝不进入版本控制。
Document/

# 依赖与构建产物
node_modules/
worker/.wrangler/

# 本地临时文件
scratch/
*.log
.DS_Store

# subagent-driven-development 的进度台账与中间产物
.superpowers/

# 本地 wrangler / 环境变量
.dev.vars
.env
```

- [ ] **Step 5: 验证 Document/ 确实被排除**

```bash
cd "C:/Users/user/Desktop/GitHub/OCR" && rtk git status --porcelain | grep -c "^?? Document/" || echo "OK: Document/ is ignored"
```

预期:输出 `OK: Document/ is ignored`。
**若输出了任何以 `?? Document/` 开头的行,停止 —— .gitignore 没生效,不要继续。**

- [ ] **Step 6: 再次确认 git 眼中看不到任何合同文件**

```bash
cd "C:/Users/user/Desktop/GitHub/OCR" && rtk git status --porcelain | grep -i -E "\.pdf|\.xlsx" || echo "OK: no document files staged or untracked"
```

预期:`OK: no document files staged or untracked`

- [ ] **Step 7: 提交基线**

```bash
cd "C:/Users/user/Desktop/GitHub/OCR" && rtk git add . && rtk git commit -m "chore: initial baseline before Phase 0 hardening" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_015Jcn7hSXhFpRjXKVgqRPYU"
```

预期:提交成功,文件列表中**不含** `Document/` 下的任何文件。

- [ ] **Step 8: 核对提交内容**

```bash
cd "C:/Users/user/Desktop/GitHub/OCR" && rtk git show --stat --name-only HEAD | grep -i "Document/" && echo "!!! ABORT: contracts committed" || echo "OK: no contracts in commit"
```

预期:`OK: no contracts in commit`。
**若输出 `!!! ABORT`,立即 `rtk git reset --hard` 并回到 Step 4 修正 .gitignore。**

- [ ] **Step 9: 切到功能分支**

基线提交留在默认分支上,后续所有 Phase 0 的改动走功能分支,便于整体回滚或对比。

```bash
cd "C:/Users/user/Desktop/GitHub/OCR" && rtk git checkout -b phase0-worker-hardening
```

预期:`Switched to a new branch 'phase0-worker-hardening'`

从这一步开始,Task 1 到 Task 6 的所有提交都落在 `phase0-worker-hardening` 上。

---

### Task 1: 设置 Google Cloud 预算上限 —— ⏸️ 由用户执行,不派 subagent

> **执行状态(2026-07-22 决定)**:本 Task 需要 Google Cloud Console 登录态,
> subagent 无法代劳。**由用户自行完成**,不阻塞 Task 3/4/6 的代码工作。
> 但它仍是 Phase 0 的完成条件之一 —— 在 Turnstile 缺席的情况下,预算上限是
> 唯一的最终兜底,重要性反而上升了。

**Files:** 无(Google Cloud Console 操作)

**Interfaces:**
- Consumes: 无
- Produces: 无代码产物。这是独立于所有代码防护的最终兜底。

**为什么排在代码之前:** 这是整个 Phase 0 里性价比最高的一项 —— 五分钟操作,且在后续所有代码防护被绕过时仍然有效。当前 Worker 是敞开的,这一步立刻把最坏情况从"无上限账单"变成"有上限"。

- [ ] **Step 1: 找到 key 所属的 project**

打开 https://console.cloud.google.com/apis/credentials

确认哪个 project 持有 `GEMINI_API_KEY` 对应的 API key。若不确定是哪一个,在 Credentials 页面逐个 key 查看其名称与创建时间,与 `npx wrangler secret list`(在 `worker/` 目录下运行)显示的 secret 存在时间对照。

- [ ] **Step 2: 确认该 project 已绑定 billing account**

打开 https://console.cloud.google.com/billing

确认 Step 1 中的 project 出现在某个 billing account 之下。

预期:project 已绑定。规格文档记录用户已确认为付费层 —— 此步是验证该前提,不是重新决策。
**若发现并未绑定,停止整个 Phase 0 并上报:免费层条款允许 Google 将提交内容用于改进产品(含人工审阅),真实合同不能走这条路。**

- [ ] **Step 3: 创建预算与告警**

在 Billing → Budgets & alerts → CREATE BUDGET:

- Scope: 仅限 Step 1 中的那个 project
- Amount: 设一个明确高于正常用量、但远低于痛感阈值的月度金额。参考:规格文档估算 15 页文档字段+正文约 $0.058/份;按每月 500 份计约 $30。建议先设 **$50/月**。
- Alert thresholds: 50%、90%、100%
- 勾选 **Email alerts to billing admins and users**

- [ ] **Step 4: 验证告警邮箱**

确认告警会发到你本人能收到的邮箱(Billing → Budgets & alerts → 点开刚建的 budget → Manage notifications)。

预期:列出的收件人包含你的账号邮箱。

- [ ] **Step 5: 记录到仓库**

在 `docs/superpowers/specs/2026-07-22-docparse-vlm-parsing-design.md` 的 `### A. Google Cloud 预算上限` 小节末尾追加一行,记录实际设定值与日期,例如:

```markdown
**已完成(2026-07-22)**:project `<project-id>` 已设 $50/月预算,告警阈值 50/90/100%,收件人 `<email>`。
```

- [ ] **Step 6: 提交**

```bash
cd "C:/Users/user/Desktop/GitHub/OCR" && rtk git add docs/ && rtk git commit -m "docs: record Google Cloud budget cap for Gemini key" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_015Jcn7hSXhFpRjXKVgqRPYU"
```

---

### Task 2: Turnstile `file://` 可行性验证(GO / NO-GO 决策关卡) —— ⏭️ 本轮跳过

> **执行状态(2026-07-22 决定)**:用户决定本轮跳过 Turnstile,按 **NO-GO** 处理。
> 本 Task 与 Task 5 均不执行。
>
> **由此产生的已接受残余风险**:Worker 的防护降为「请求体校验 + 按 IP 限流 +
> 预算上限」三层。批量滥用被限流挡住,最坏账单被预算上限兜住,但**单个知道
> URL 的人仍可在 20 次/分钟的限额内白嫖**。这是明知的取舍,不是遗漏。
>
> 下方步骤保留,供日后决定重启 Turnstile 时直接使用。

**Files:**
- Create: `scratch/turnstile-spike.html`(临时,验证后删除)

**Interfaces:**
- Consumes: 无
- Produces: **一个 GO / NO-GO 决策**,决定 Task 5 是否执行。不产出生产代码。

**背景:** Turnstile widget 的 sitekey 绑定域名,而从 `file://` 打开的页面没有有效 hostname。Turnstile 能否在这种环境下签发 token 属未知。规格文档要求在写任何集成代码之前先验证,避免在不可行的路径上投入。

**决策规则:**
- 拿到非空 token → **GO**,执行 Task 5。
- `error-callback` 触发,或脚本无法加载 → **NO-GO**,跳过 Task 5。此时残余风险为:限流挡住批量滥用、预算上限兜住最坏情况,但单个知道 URL 的人仍能在限额内白嫖。这是**已接受的**残余风险,不是遗漏。

- [ ] **Step 1: 查证当前的 Turnstile 测试 sitekey**

使用 `cloudflare` skill 或访问 https://developers.cloudflare.com/turnstile/troubleshooting/testing/ 查证「always passes, visible」的**测试 sitekey**当前值。

写下查到的值备用。本计划中以 `<TEST_SITEKEY>` 指代。
(截至撰写时该值为 `1x00000000000000000000AA`,但**必须以文档为准**,不要直接采信此处的字面值。)

- [ ] **Step 2: 写验证页**

创建 `scratch/turnstile-spike.html`,内容完全如下(把 `<TEST_SITEKEY>` 替换为 Step 1 查到的值):

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Turnstile file:// spike</title>
</head>
<body>
<h1>Turnstile file:// feasibility spike</h1>
<p>Stage 1 — test sitekey (isolates "does the script run at all" from "is my domain allowlisted").</p>
<div id="ts"></div>
<pre id="out" style="font-family:monospace;white-space:pre-wrap;border:1px solid #999;padding:10px">waiting...</pre>
<script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" async defer></script>
<script>
  var out = document.getElementById('out');
  function log(msg) { out.textContent = msg; console.log('[spike]', msg); }

  window.addEventListener('load', function () {
    setTimeout(function () {
      if (typeof window.turnstile === 'undefined') {
        log('NO-GO: turnstile script did not load from file:// (window.turnstile undefined)');
        return;
      }
      try {
        window.turnstile.render('#ts', {
          sitekey: '<TEST_SITEKEY>',
          callback: function (token) {
            log('GO: token received, length=' + token.length + '\n\n' + token);
          },
          'error-callback': function (code) {
            log('NO-GO: error-callback fired, code=' + code);
          },
        });
        log('rendered, waiting for callback...');
      } catch (e) {
        log('NO-GO: render() threw: ' + e.message);
      }
    }, 1500);
  });
</script>
</body>
</html>
```

- [ ] **Step 3: 在浏览器中打开并观察**

双击 `scratch/turnstile-spike.html`(或在 Chrome 地址栏输入其 `file:///C:/Users/.../scratch/turnstile-spike.html` 路径)。

同时打开 DevTools Console 观察网络与错误。

预期三种结果之一:
- `GO: token received, length=...` → 记录为 **GO**
- `NO-GO: ...` → 记录为 **NO-GO**
- 页面一直停在 `rendered, waiting for callback...` 超过 30 秒 → 记录为 **NO-GO**(视同失败)

- [ ] **Step 4: 若 Stage 1 为 GO,用真实 sitekey 再验一次**

仅当 Step 3 结果为 GO 才做这一步。

在 https://dash.cloudflare.com/?to=/:account/turnstile 创建一个 widget:
- Widget mode: **Managed**
- Domains: 由于 `file://` 无 hostname,尝试添加 `localhost`,并观察是否允许留空或通配

把新 sitekey 替换进 `scratch/turnstile-spike.html` 的 `sitekey` 字段,重新打开页面。

预期:同样拿到 token → 最终判定 **GO**。
若真实 sitekey 报 `error-callback`(通常是 domain 校验失败)而测试 sitekey 通过 → 判定 **NO-GO**,并在记录中注明"脚本可运行,但域名校验在 `file://` 下无法通过"。

- [ ] **Step 5: 把结论写进 spec**

在 `docs/superpowers/specs/2026-07-22-docparse-vlm-parsing-design.md` 的 `### D. Turnstile —— 先实测,失败则放弃` 小节末尾追加实测结果,格式:

```markdown
**实测结果(2026-07-22)**:GO / NO-GO。观察到:<具体现象,含 error code(若有)>。
决定:<纳入 Task 5 / 放弃,仅保留限流 + 预算上限>。
```

- [ ] **Step 6: 删除验证页**

```bash
cd "C:/Users/user/Desktop/GitHub/OCR" && rm scratch/turnstile-spike.html
```

(`scratch/` 已在 `.gitignore` 中,本来就不会被提交;删除是为了不留下含 sitekey 的残留文件。)

- [ ] **Step 7: 提交结论**

```bash
cd "C:/Users/user/Desktop/GitHub/OCR" && rtk git add docs/ && rtk git commit -m "docs: record Turnstile file:// feasibility spike result" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_015Jcn7hSXhFpRjXKVgqRPYU"
```

---

### Task 3: Worker 请求体校验

**Files:**
- Create: `worker/limits.js`
- Create: `worker/limits.test.js`
- Create: `worker/package.json`
- Modify: `worker/worker.js`

**Interfaces:**
- Consumes: 无
- Produces:
  - `worker/limits.js` 导出 `LIMITS`(常量对象)与 `validateRequest(body) -> { ok: true } | { ok: false, status: number, error: string }`
  - Task 4 会在 `worker.js` 中于 `validateRequest` 调用**之前**插入限流检查

**为什么抽成独立文件:** `validateRequest` 是纯函数(不碰 `Request`、`env`、Workers runtime API),放进单独文件后可以用普通 vitest 在 Node 下直接单测,不需要 `@cloudflare/vitest-pool-workers` 那套更重的依赖。

- [ ] **Step 1: 建立 worker/ 的测试环境**

创建 `worker/package.json`,内容完全如下:

```json
{
  "name": "docparse-worker",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run"
  },
  "devDependencies": {
    "vitest": "^3.2.4"
  }
}
```

然后安装:

```bash
cd "C:/Users/user/Desktop/GitHub/OCR/worker" && rtk npm install
```

预期:创建 `worker/node_modules/` 与 `worker/package-lock.json`,无报错。

- [ ] **Step 2: 写失败的测试**

创建 `worker/limits.test.js`,内容完全如下:

```js
import { describe, it, expect } from 'vitest';
import { LIMITS, validateRequest } from './limits.js';

const pdfPart = { inline_data: { mime_type: 'application/pdf', data: 'AAAA' } };

describe('validateRequest', () => {
  it('accepts a minimal valid body', () => {
    const body = { contents: [{ parts: [{ text: 'extract fields' }, pdfPart] }] };
    expect(validateRequest(body)).toEqual({ ok: true });
  });

  it('rejects a missing contents array', () => {
    const r = validateRequest({});
    expect(r.ok).toBe(false);
    expect(r.status).toBe(400);
  });

  it('rejects contents that is not an array', () => {
    const r = validateRequest({ contents: 'nope' });
    expect(r.ok).toBe(false);
    expect(r.status).toBe(400);
  });

  it('rejects more inline parts than the cap', () => {
    const parts = Array.from({ length: LIMITS.MAX_INLINE_PARTS + 1 }, () => pdfPart);
    const r = validateRequest({ contents: [{ parts }] });
    expect(r.ok).toBe(false);
    expect(r.status).toBe(400);
    expect(r.error).toMatch(/attachment/i);
  });

  it('accepts exactly the inline part cap', () => {
    const parts = Array.from({ length: LIMITS.MAX_INLINE_PARTS }, () => pdfPart);
    expect(validateRequest({ contents: [{ parts }] })).toEqual({ ok: true });
  });

  it('rejects a disallowed mime type', () => {
    const body = {
      contents: [{ parts: [{ inline_data: { mime_type: 'video/mp4', data: 'AAAA' } }] }],
    };
    const r = validateRequest(body);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/video\/mp4/);
  });

  it('rejects an inline part with no mime type', () => {
    const body = { contents: [{ parts: [{ inline_data: { data: 'AAAA' } }] }] };
    const r = validateRequest(body);
    expect(r.ok).toBe(false);
  });

  it('also validates camelCase inlineData', () => {
    const body = {
      contents: [{ parts: [{ inlineData: { mimeType: 'video/mp4', data: 'AAAA' } }] }],
    };
    const r = validateRequest(body);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/video\/mp4/);
  });

  it('rejects text longer than the cap', () => {
    const body = {
      contents: [{ parts: [{ text: 'x'.repeat(LIMITS.MAX_TEXT_CHARS + 1) }] }],
    };
    const r = validateRequest(body);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/text/i);
  });

  it('rejects a body with no parts at all', () => {
    const r = validateRequest({ contents: [{}] });
    expect(r.ok).toBe(false);
  });

  // An early `continue` out of the inline branch would skip the text
  // check entirely, letting an over-length text ride along on a valid
  // attachment. These four lock that door.
  it('rejects over-cap text smuggled onto a part that also has inline_data', () => {
    const body = {
      contents: [{ parts: [{
        inline_data: { mime_type: 'application/pdf', data: 'AAAA' },
        text: 'X'.repeat(LIMITS.MAX_TEXT_CHARS + 1),
      }] }],
    };
    const r = validateRequest(body);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/text/i);
  });

  it('accepts a part carrying both inline_data and under-cap text', () => {
    const body = {
      contents: [{ parts: [{
        inline_data: { mime_type: 'application/pdf', data: 'AAAA' },
        text: 'extract fields',
      }] }],
    };
    expect(validateRequest(body)).toEqual({ ok: true });
  });

  it('accumulates text across several parts that each also carry inline_data', () => {
    const half = 'X'.repeat(Math.ceil((LIMITS.MAX_TEXT_CHARS + 2) / 2));
    const part = () => ({
      inline_data: { mime_type: 'application/pdf', data: 'AAAA' },
      text: half,
    });
    const r = validateRequest({ contents: [{ parts: [part(), part()] }] });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/text/i);
  });

  it('rejects a part with neither inline_data nor text', () => {
    const r = validateRequest({ contents: [{ parts: [{ foo: 'bar' }] }] });
    expect(r.ok).toBe(false);
  });
});
```

- [ ] **Step 3: 运行测试确认失败**

```bash
cd "C:/Users/user/Desktop/GitHub/OCR/worker" && rtk npm test
```

预期:全部失败,报错为无法解析 `./limits.js`(模块不存在)。

- [ ] **Step 4: 实现 limits.js**

创建 `worker/limits.js`,内容完全如下:

```js
// Server-side hardcoded limits for the Docparse Gemini proxy.
//
// These exist because the Worker is reachable by anyone who reads
// SMART_ENDPOINT out of the distributed zip. Without them it is a free,
// unmetered, general-purpose Gemini proxy billed to our key.
//
// Every value here is hardcoded on purpose: the client never gets to
// raise a limit, same reasoning as the generationConfig in worker.js.

export const LIMITS = {
  // Raw JSON request body. A 15 MB PDF is ~20 MB once base64-encoded
  // (4/3 inflation), so this leaves headroom above the client's own
  // PDF_INLINE_MAX_BYTES without allowing anything wild.
  MAX_BODY_BYTES: 24 * 1024 * 1024,

  // AI_MAX_PAGES on the client is 15; allow some slack for a prompt part
  // and batch overlap, but not an unbounded image dump.
  MAX_INLINE_PARTS: 20,

  // Enough for a large spreadsheet dumped as CSV (the client slices at
  // 200k), but not enough to use this as a general text LLM.
  MAX_TEXT_CHARS: 200000,

  ALLOWED_MIME: [
    'application/pdf',
    'image/png',
    'image/jpeg',
    'image/webp',
  ],
};

function fail(error, status = 400) {
  return { ok: false, status, error };
}

// Gemini accepts both snake_case (inline_data/mime_type) and camelCase
// (inlineData/mimeType). The Docparse client sends snake_case, but accept
// and validate both so camelCase can't be used to bypass the whitelist.
function readInline(part) {
  const inline = part.inline_data || part.inlineData;
  if (!inline) return null;
  return { mime: inline.mime_type || inline.mimeType || null };
}

export function validateRequest(body) {
  if (!body || typeof body !== 'object') return fail('Invalid body');
  if (!Array.isArray(body.contents)) return fail('Missing contents');

  let inlineCount = 0;
  let textChars = 0;
  let partCount = 0;

  for (const content of body.contents) {
    if (!content || typeof content !== 'object') return fail('Invalid content entry');
    if (!Array.isArray(content.parts)) return fail('Missing parts');

    for (const part of content.parts) {
      if (!part || typeof part !== 'object') return fail('Invalid part');
      partCount++;

      // inline_data and text are checked INDEPENDENTLY, not as an
      // either/or. A single part may legitimately carry both, and an
      // early `continue` out of the inline branch would let an
      // over-length `text` ride along on a valid attachment — which
      // defeats MAX_TEXT_CHARS entirely.
      let handled = false;

      const inline = readInline(part);
      if (inline) {
        handled = true;
        inlineCount++;
        if (inlineCount > LIMITS.MAX_INLINE_PARTS) {
          return fail(`Too many attachments (max ${LIMITS.MAX_INLINE_PARTS})`);
        }
        if (!inline.mime) return fail('Attachment is missing a mime type');
        if (!LIMITS.ALLOWED_MIME.includes(inline.mime)) {
          return fail(`Unsupported attachment type: ${inline.mime}`);
        }
      }

      if (typeof part.text === 'string') {
        handled = true;
        textChars += part.text.length;
        if (textChars > LIMITS.MAX_TEXT_CHARS) {
          return fail(`Text content too long (max ${LIMITS.MAX_TEXT_CHARS} characters)`);
        }
      }

      if (!handled) return fail('Unsupported part type');
    }
  }

  if (partCount === 0) return fail('Request contains no content');

  return { ok: true };
}
```

- [ ] **Step 5: 运行测试确认通过**

```bash
cd "C:/Users/user/Desktop/GitHub/OCR/worker" && rtk npm test
```

预期:10 个测试全部 PASS。

- [ ] **Step 6: 把校验接进 worker.js**

修改 `worker/worker.js`。

在文件顶部,`const GEMINI_URL = ...` 之前,加入 import:

```js
import { LIMITS, validateRequest } from './limits.js';
```

然后把现有的 body 解析段落(当前的 `let body; try { body = await request.json(); } catch ...`)整段替换为:

```js
    // Read as text first so the raw size can be capped BEFORE parsing —
    // JSON.parse on a huge body is itself the denial-of-service.
    //
    // Measure BYTES, not String.length: request.text() decodes UTF-8 into
    // a JS string whose .length counts UTF-16 code units, so 1000 CJK
    // characters read as 1000 but weigh 3000 bytes on the wire. Using
    // .length would let a multi-byte body run ~3x over the cap.
    const declared = Number(request.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > LIMITS.MAX_BODY_BYTES) {
      return json({ error: 'Request too large' }, 413);
    }

    const raw = await request.text();
    if (new TextEncoder().encode(raw).length > LIMITS.MAX_BODY_BYTES) {
      return json({ error: 'Request too large' }, 413);
    }

    let body;
    try {
      body = JSON.parse(raw);
    } catch (e) {
      return json({ error: 'Invalid JSON body' }, 400);
    }

    const check = validateRequest(body);
    if (!check.ok) {
      return json({ error: check.error }, check.status);
    }
```

并**删除**现有的这段(它已被 `validateRequest` 覆盖):

```js
    if (!Array.isArray(payload.contents)) {
      return json({ error: 'Missing contents' }, 400);
    }
```

- [ ] **Step 7: 本地启动 Worker**

```bash
cd "C:/Users/user/Desktop/GitHub/OCR/worker" && rtk npx wrangler dev --port 8787
```

预期:输出本地地址 `http://localhost:8787`。保持此终端运行,在另一个终端做 Step 8。

注意:本地 dev 没有 `GEMINI_API_KEY` secret,转发到 Gemini 会失败 —— 这没关系,本步只验证**校验层在到达转发之前就拦下了请求**。

- [ ] **Step 8: 手工验证拦截生效**

```bash
curl -s -X POST http://localhost:8787 -H "Content-Type: application/json" \
  -d '{"contents":[{"parts":[{"inline_data":{"mime_type":"video/mp4","data":"AAAA"}}]}]}'
```

预期:`{"error":"Unsupported attachment type: video/mp4"}`,HTTP 400。

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:8787 \
  -H "Content-Type: application/json" -d '{"contents":"nope"}'
```

预期:`400`

```bash
curl -s -X POST http://localhost:8787 -H "Content-Type: application/json" -d '{}'
```

预期:`{"error":"Missing contents"}`

- [ ] **Step 9: 停止 dev 服务器并提交**

在 Step 7 的终端按 `Ctrl+C`,然后:

```bash
cd "C:/Users/user/Desktop/GitHub/OCR" && rtk git add worker/ && rtk git commit -m "feat(worker): validate request shape, size, mime types and text length" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_015Jcn7hSXhFpRjXKVgqRPYU"
```

预期:提交内容包含 `worker/limits.js`、`worker/limits.test.js`、`worker/package.json`、`worker/package-lock.json`、`worker/worker.js`,且**不含** `worker/node_modules/`。

---

### Task 4: 按 IP 限流

**Files:**
- Modify: `worker/wrangler.toml`
- Modify: `worker/worker.js`

**Interfaces:**
- Consumes: `worker/worker.js` 中 Task 3 建立的 `validateRequest` 调用位置
- Produces: `env.RATE_LIMITER` 绑定;限流检查置于 `validateRequest` **之前**(先挡住洪水,再做解析工作)

**为什么用 Workers 的 ratelimit 绑定而非 WAF 规则:** Cloudflare 的 WAF / Rate Limiting Rules 作用于用户自己 zone 下的域名。当前 Worker 通过 `*.workers.dev` 子域暴露,不属于用户 zone,WAF 规则不适用。Workers 原生的 ratelimit 绑定直接在 Worker 运行时生效,不依赖 zone。

- [ ] **Step 1: 查证当前的 ratelimit 绑定语法**

使用 `wrangler` skill 或 `cloudflare` skill 查证 Workers Rate Limiting 绑定在 `wrangler.toml` 中的**当前**配置语法与 `env.<NAME>.limit()` 的**当前**签名。

该 API 的绑定形式历史上变更过(曾在 `[[unsafe.bindings]]` 下),**不要直接采信下面 Step 2/3 的字面语法** —— 以查到的文档为准,若有出入按文档修正。

- [ ] **Step 2: 加绑定**

在 `worker/wrangler.toml` 末尾追加(按 Step 1 查证结果调整语法):

```toml
# Per-IP rate limit. The Worker URL ships inside a distributed zip, so it
# must survive being called by anyone who reads index.html. WAF rate
# limiting rules don't apply to *.workers.dev (not in our zone), so this
# uses the Workers-native rate limiting binding instead.
[[unsafe.bindings]]
name = "RATE_LIMITER"
type = "ratelimit"
namespace_id = "1001"
simple = { limit = 20, period = 60 }
```

限额取值理由:一次 Smart extract 是一个请求;规格文档中 Phase 1 的分批会让一份 39 页文档产生约 8 个请求。20 次/分钟给正常使用留足余量,同时把滥用者压到无法批量刷取。

- [ ] **Step 3: 在 worker.js 中接入**

修改 `worker/worker.js`,在 `if (request.method !== 'POST')` 检查**之后**、Task 3 加入的 `const raw = await request.text();` **之前**,插入:

```js
    // Rate-limit before reading the body: the point is to shed load, and
    // reading a 24 MB body just to reject it defeats that.
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const { success } = await env.RATE_LIMITER.limit({ key: ip });
    if (!success) {
      return json({ error: 'Too many requests — please wait a moment and try again.' }, 429);
    }
```

- [ ] **Step 4: 本地启动**

```bash
cd "C:/Users/user/Desktop/GitHub/OCR/worker" && rtk npx wrangler dev --port 8787
```

预期:启动成功,无绑定相关报错。
**若报错说 ratelimit 绑定无法识别,回到 Step 1 按当前文档修正语法。**

- [ ] **Step 5: 验证限流生效**

在另一个终端:

```bash
for i in $(seq 1 25); do
  curl -s -o /dev/null -w "%{http_code} " -X POST http://localhost:8787 \
    -H "Content-Type: application/json" -d '{}'
done; echo
```

预期:前若干次返回 `400`(被 `validateRequest` 拒绝,说明限流放行了),达到 20 次后开始返回 `429`。

注意:`wrangler dev` 本地对限流绑定的模拟行为可能与线上不同。若本地全部返回 `400` 而无 `429`,不视为失败 —— 在 Step 7 部署后于线上复验。

- [ ] **Step 6: 停止 dev 并提交**

`Ctrl+C` 停止,然后:

```bash
cd "C:/Users/user/Desktop/GitHub/OCR" && rtk git add worker/ && rtk git commit -m "feat(worker): add per-IP rate limiting" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_015Jcn7hSXhFpRjXKVgqRPYU"
```

- [ ] **Step 7: 部署并在线上复验**

```bash
cd "C:/Users/user/Desktop/GitHub/OCR/worker" && rtk npx wrangler deploy
```

预期:部署成功,输出 `https://docparse-ai.f6v9zfjpcs.workers.dev`。

然后对线上地址复跑 Step 5 的循环(把 `http://localhost:8787` 换成线上 URL):

预期:达到限额后出现 `429`。

- [ ] **Step 8: 确认正常路径未被误伤**

这是本 Task 最关键的验收点:新加的校验和限流**绝不能拒绝客户端真实发出的
payload 形状**。如果误伤,已经分发出去的 zip 会当场坏掉。

先等 60 秒让 Step 5/7 的限流计数窗口过期,然后用与 `smartExtract()` 完全
相同的 body 形状发两个请求。

检查一:纯文本 part(对应 Excel/CSV 路径)

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://docparse-ai.f6v9zfjpcs.workers.dev/ \
  -H "Content-Type: application/json" \
  -d '{"contents":[{"parts":[{"text":"Reply with the single word OK."}]}]}'
```

预期:`200`。**若是 400,说明 `validateRequest` 误伤了正常请求,停止排查。**

检查二:文本 + inline_data 附件(对应 PDF / 图片路径)

下面用一个 1x1 PNG 作最小附件,验证 mime 白名单接受真实的 `inline_data` 形状:

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://docparse-ai.f6v9zfjpcs.workers.dev/ \
  -H "Content-Type: application/json" \
  -d '{"contents":[{"parts":[{"text":"What colour is this image? Reply in one word."},{"inline_data":{"mime_type":"image/png","data":"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="}}]}]}'
```

预期:`200`。**若是 400,说明 mime 白名单或 part 判定有误,停止排查。**

这两个请求会真实调用 Gemini,成本约为百分之一美分量级,可以忽略。

---

### Task 5: Turnstile 集成(条件执行) —— ⏭️ 本轮跳过

> **执行状态(2026-07-22 决定)**:Task 2 已按 NO-GO 处理,故本 Task 不执行。
> 步骤保留供日后使用。

**⚠️ 仅当 Task 2 的结论为 GO 时执行本 Task。若为 NO-GO,跳过,直接进入 Task 6。**

**Files:**
- Modify: `worker/worker.js`
- Modify: `worker/wrangler.toml`
- Modify: `Docparse/index.html`

**Interfaces:**
- Consumes: Task 4 建立的限流检查(Turnstile 校验置于其后、`validateRequest` 之前)
- Produces: 客户端在每次 Smart extract 请求的 body 中附带 `turnstileToken` 字段;Worker 侧 siteverify 校验后剥除该字段,不转发给 Gemini

- [ ] **Step 1: 创建生产 widget 并保存密钥**

在 https://dash.cloudflare.com/?to=/:account/turnstile 创建 widget(若 Task 2 Step 4 已创建则复用):
- Widget mode: **Managed**
- 记下 **Site Key**(公开,进 index.html)与 **Secret Key**(私密,进 Worker secret)

```bash
cd "C:/Users/user/Desktop/GitHub/OCR/worker" && rtk npx wrangler secret put TURNSTILE_SECRET
```

在提示符处粘贴 Secret Key。

预期:`✨ Success! Uploaded secret TURNSTILE_SECRET`

- [ ] **Step 2: Worker 侧校验**

修改 `worker/worker.js`,在 Task 4 加入的限流检查**之后**、`const raw = await request.text();` **之前**插入:

```js
    // Turnstile: proves a real browser is on the other end. The token is
    // consumed here and never forwarded to Gemini.
    const tsToken = request.headers.get('CF-Turnstile-Token');
    if (!tsToken) {
      return json({ error: 'Verification required' }, 403);
    }
    const tsForm = new FormData();
    tsForm.append('secret', env.TURNSTILE_SECRET);
    tsForm.append('response', tsToken);
    tsForm.append('remoteip', ip);
    const tsRes = await fetch(
      'https://challenges.cloudflare.com/turnstile/v0/siteverify',
      { method: 'POST', body: tsForm }
    );
    const tsJson = await tsRes.json();
    if (!tsJson.success) {
      return json({ error: 'Verification failed — please reload the page and try again.' }, 403);
    }
```

把 token 放在 **header** 而非 body,是为了不让它混进 `validateRequest` 要检查的 `contents` 结构里,也不必在转发前剥除。

同时更新 CORS 允许的 header(`worker/worker.js:14-18`):

```js
const CORS = {
  'Access-Control-Allow-Origin': '*',            // file:// pages send Origin: null
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, CF-Turnstile-Token',
};
```

- [ ] **Step 3: 客户端取 token**

修改 `Docparse/index.html`。在现有的三个 `<script src="...">` 标签(`index.html:229-233`)之后加入:

```html
<!-- Turnstile: proves a real browser is calling the smart-extract proxy.
     Only loaded/used for Smart extract; local reading never touches it. -->
<script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" async defer></script>
```

在 `<div id="results">` 的 toolbar 之后、`</div>` 之前加入容器:

```html
    <div id="tsWidget" style="margin-top:12px"></div>
```

在 JS 中,`SMART_ENDPOINT` 常量附近加入(把 `<SITE_KEY>` 换成 Step 1 的 Site Key):

```js
  const TURNSTILE_SITEKEY = '<SITE_KEY>';
  let _tsToken = null;

  function initTurnstile() {
    if (typeof window.turnstile === 'undefined') return;
    window.turnstile.render('#tsWidget', {
      sitekey: TURNSTILE_SITEKEY,
      callback: (t) => { _tsToken = t; },
      'expired-callback': () => { _tsToken = null; initTurnstile(); },
    });
  }
  window.addEventListener('load', initTurnstile);
```

在 `smartExtract()` 的 fetch 处,把 header 改为:

```js
        res = await fetch(SMART_ENDPOINT, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'CF-Turnstile-Token': _tsToken || '',
          },
          body: JSON.stringify({ contents: [{ parts }] }),
        });
```

并在 `smartExtract()` 开头的既有前置检查之后加入:

```js
    if (!_tsToken) {
      errorEl.textContent = 'Still verifying your browser — wait a second and try again.';
      errorEl.classList.add('show');
      return;
    }
```

- [ ] **Step 4: 部署 Worker**

```bash
cd "C:/Users/user/Desktop/GitHub/OCR/worker" && rtk npx wrangler deploy
```

预期:部署成功。

- [ ] **Step 5: 端到端验证**

双击打开 `Docparse/index.html`,拖入 `Document/` 下一份 PDF,点 **Read document**,再点 **Smart extract**。

预期:Turnstile widget 出现并自动通过,Smart extract 正常返回字段表。

- [ ] **Step 6: 验证无 token 时被拒**

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://docparse-ai.f6v9zfjpcs.workers.dev/ \
  -H "Content-Type: application/json" -d '{"contents":[{"parts":[{"text":"hi"}]}]}'
```

预期:`403`(没有 `CF-Turnstile-Token` header)。**这是本 Task 的核心验收点** —— 它证明裸 curl 已经无法白嫖这个端点。

- [ ] **Step 7: 提交**

```bash
cd "C:/Users/user/Desktop/GitHub/OCR" && rtk git add worker/ Docparse/index.html && rtk git commit -m "feat: require Turnstile verification for smart extract proxy" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_015Jcn7hSXhFpRjXKVgqRPYU"
```

---

### Task 6: 移除死掉的用户自填 key 路径,并修正报错文案

**Files:**
- Modify: `Docparse/index.html`

**Interfaces:**
- Consumes: 无(纯清理)
- Produces: `smartExtract()` 只剩 Worker 一条路径;`usingWorker`、`getAiKey`、`setAiKey`、`GEMINI_DIRECT_URL` 全部消失

**背景:** `usingWorker`(`Docparse/index.html:1316`)恒为 true,因为 `SMART_ENDPOINT`(`:1305`)已是线上 URL。因此 `:1321-1341` 整个 `else` 分支从未执行 —— `getAiKey`/`setAiKey` 用 `var` 声明在该分支内,变量被提升但永不赋值。该路径当初只是作者自己贴 key 做测试的便利通道,不是产品功能,用户已确认无需保留。

`:1450` 的 `'Key rejected.'` 文案对当前每一个用户都是误导:他们根本没有 key 可以被拒。400 更可能是 payload 问题(超大 inline_data、错误 mime)。

- [ ] **Step 1: 删除 key 输入框的 HTML**

删除 `Docparse/index.html:188-193` 整段:

```html
  <div id="aiRow">
    <span class="ai-label">Gemini API key</span>
    <input type="password" id="aiKeyInput" placeholder="Paste your Gemini API key to enable Smart extract">
    <button id="aiKeySaveBtn">Save</button>
  </div>
  <p class="ai-hint" id="aiHint">Optional — only needed for "Smart extract" below. Stored in this browser only, never uploaded anywhere except directly to Google when you click Smart extract. <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">Get a free key &rarr;</a></p>
```

- [ ] **Step 2: 删除 #aiRow 的 CSS,保留 .ai-hint**

在 `Docparse/index.html:108-115`,删除这五条:

```css
  #aiRow { display: flex; gap: 8px; align-items: center; margin-top: 14px; font-family: var(--mono); }
  #aiRow .ai-label { font-size: 10.5px; color: var(--accent); text-transform: uppercase; letter-spacing: 0.05em; white-space: nowrap; }
  #aiRow input { flex: 1; border: 1px solid var(--rule); background: #fdfcf9; padding: 8px 10px; font-family: var(--mono); font-size: 12px; color: var(--ink); min-width: 120px; }
  #aiRow button { font-family: var(--mono); font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; background: none; border: 1px solid var(--rule); color: var(--ink-soft); padding: 8px 12px; cursor: pointer; }
  #aiRow button:hover { border-color: var(--ink); color: var(--ink); }
  #aiRow button.saved { border-color: var(--accent); color: var(--accent); }
```

**保留**这两条不动 —— 规格文档 1.16 节的 `#smartExtractNudge` 会在 Phase 1 复用它们:

```css
  p.ai-hint { font-family: var(--mono); font-size: 11px; color: var(--ink-soft); margin: 6px 0 0; }
  p.ai-hint a { color: var(--accent); }
```

- [ ] **Step 3: 删除移动端媒体查询里的 #aiRow 规则**

在 `Docparse/index.html:147-148`,删除这两行:

```css
    #aiRow { flex-direction: column; align-items: stretch; }
    #aiRow .ai-label { white-space: normal; }
```

- [ ] **Step 4: 删除 GEMINI_DIRECT_URL 常量**

删除 `Docparse/index.html:1308-1309`:

```js
  const GEMINI_DIRECT_URL =
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';
```

- [ ] **Step 5: 删除元素查找与 usingWorker 分支**

删除 `Docparse/index.html:1312-1341` 中的这些行:

```js
  const aiRow = document.getElementById('aiRow');
  const aiHint = document.getElementById('aiHint');
  const aiKeyInput = document.getElementById('aiKeyInput');
  const aiKeySaveBtn = document.getElementById('aiKeySaveBtn');
  const usingWorker = !SMART_ENDPOINT.includes('YOUR-WORKER-URL');
```

以及紧随其后的整个 `if (usingWorker) { ... } else { ... }` 块(从 `if (usingWorker) {` 到对应的收尾 `}`)。

**保留** `const aiExtractBtn = document.getElementById('aiExtractBtn');`(`:1311`)—— 它是 Smart extract 按钮,仍在使用。

- [ ] **Step 6: 清理 smartExtract() 中的 key 检查**

删除 `Docparse/index.html:1390-1395`:

```js
    if (!usingWorker && !getAiKey()) {
      errorEl.textContent = 'Paste and save your Gemini API key above first.';
      errorEl.classList.add('show');
      aiKeyInput.focus();
      return;
    }
```

- [ ] **Step 7: 把 fetch 的双分支收敛成一条**

把 `Docparse/index.html:1429-1445` 的整个 `let res; if (usingWorker) { ... } else { ... }` 替换为:

```js
      const res = await fetch(SMART_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts }] }),
      });
```

**注意:** 本轮 Task 5(Turnstile)已跳过,因此这里就是最终形态,不需要额外的 header。

- [ ] **Step 8: 修正报错文案**

把 `Docparse/index.html:1447-1453` 的错误处理替换为:

```js
      if (!res.ok) {
        let detail = '';
        try { detail = (await res.json()).error?.message || ''; } catch (e) {}
        if (res.status === 413) throw new Error('This document is too large for smart extraction. ' + detail);
        if (res.status === 403) throw new Error('Verification failed — reload the page and try again. ' + detail);
        if (res.status === 429) throw new Error('Too many requests — wait a moment and try again. ' + detail);
        if (res.status === 400) throw new Error('This document could not be sent for smart extraction. ' + detail);
        throw new Error('Smart extraction failed (' + res.status + '). ' + detail);
      }
```

- [ ] **Step 9: 确认没有残留引用**

```bash
cd "C:/Users/user/Desktop/GitHub/OCR" && grep -n -E "usingWorker|getAiKey|setAiKey|aiKeyInput|aiKeySaveBtn|GEMINI_DIRECT_URL|docparse_temp_key|aiRow|aiHint" Docparse/index.html || echo "OK: no leftover references"
```

预期:`OK: no leftover references`
**若有输出,逐条清理干净再继续。**

- [ ] **Step 10: 语法校验(自动)**

删除大段代码最容易留下不匹配的花括号。把 `index.html` 的 `<script>` 内容抽出来
交给 Node 做语法检查:

```bash
cd "C:/Users/user/Desktop/GitHub/OCR" && node -e "
const fs = require('fs');
const html = fs.readFileSync('Docparse/index.html', 'utf8');
const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
if (!blocks.length) { console.error('FAIL: no inline script block found'); process.exit(1); }
fs.writeFileSync('scratch/_syntax_check.js', blocks.join('\n;\n'));
console.log('extracted ' + blocks.length + ' inline script block(s)');
" && node --check scratch/_syntax_check.js && echo "OK: inline JS parses" && rm scratch/_syntax_check.js
```

预期:`OK: inline JS parses`
**若报语法错误,按提示的行号修复后重跑,不要提交。**

(若 `scratch/` 不存在,先 `mkdir -p scratch`。该目录已在 `.gitignore` 中。)

- [ ] **Step 11: 确认没有孤儿 DOM 引用**

删掉 HTML 元素却漏删对应的 `getElementById` 会在运行时抛 null。逐一核对
`index.html` 中每个 `getElementById('...')` 的 id 都还存在于 HTML 里:

```bash
cd "C:/Users/user/Desktop/GitHub/OCR" && node -e "
const fs = require('fs');
const html = fs.readFileSync('Docparse/index.html', 'utf8');
const ids = new Set([...html.matchAll(/\bid=\"([^\"]+)\"/g)].map(m => m[1]));
const refs = [...html.matchAll(/getElementById\('([^']+)'\)/g)].map(m => m[1]);
const missing = [...new Set(refs)].filter(r => !ids.has(r));
if (missing.length) { console.error('FAIL: getElementById targets not in HTML: ' + missing.join(', ')); process.exit(1); }
console.log('OK: all ' + new Set(refs).size + ' getElementById targets exist');
"
```

预期:`OK: all N getElementById targets exist`
**若报 FAIL,说明删 HTML 时漏删了对应的 JS 引用,修复后重跑。**

- [ ] **Step 12: 提交**

```bash
cd "C:/Users/user/Desktop/GitHub/OCR" && rtk git add Docparse/index.html && rtk git commit -m "refactor: drop dead per-user API key path, fix misleading error copy" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_015Jcn7hSXhFpRjXKVgqRPYU"
```

---

## Phase 0 完成标准

**本轮执行范围:Task 0、3、4、6。** Task 1 由用户在控制台完成;Task 2、5(Turnstile)本轮跳过。

由 agent 验证:

- [ ] `Document/` 未进入 git(`rtk git log --all --name-only | grep -i Document/` 无输出)
- [ ] 裸 curl 发送非法 mime 被 400 拒绝
- [ ] 裸 curl 超频被 429 拒绝
- [ ] 客户端真实 payload 形状(文本 part / 文本+inline_data)仍返回 200
- [ ] `Docparse/index.html` 中无任何 key 输入 UI 与死代码,内联 JS 语法通过,无孤儿 DOM 引用
- [ ] `cd worker && rtk npm test` 全部通过

由用户完成/验证(不阻塞上述):

- [ ] **Google Cloud 预算上限已设,告警邮箱已验证(Task 1)** —— Turnstile 缺席后,这是唯一的最终兜底,重要性上升
- [ ] 双击打开 `Docparse/index.html`,拖入一份真实 PDF,Read document → Smart extract 端到端正常

已接受的残余风险(非遗漏):

- 单个知道 Worker URL 的人仍可在 20 次/分钟限额内白嫖。Turnstile 是堵死这个洞的手段,本轮主动跳过。

## 不在本期范围内

以下为规格文档中记录、但**明确留到后续**的项目,不要在 Phase 0 中顺手做:

- VLM 正文版面解析(Phase 1)
- 左右分栏 UI(Phase 2)
- `appendExcelBody()` 的 `innerHTML` 加固(`Docparse/index.html:1100-1101`)—— 规格附录列为 SHOULD-fix
- `docparse_history` 明文存储收紧(`Docparse/index.html:1526-1555`)
- `index.html:163` / `:226` 与 `README.md:46-47` 的文案修正 —— 属于 Phase 1(1.15 节),因为届时才会同时改变上传行为
- 把 `index.html` 拆成多个 `<script src>` 文件
