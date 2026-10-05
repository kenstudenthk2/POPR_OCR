# Docparse — VLM 版面解析增强 + 分栏 UI 设计

日期:2026-07-22
状态:待实施(Phase 0 先行)

## 背景

Docparse 是一个单文件浏览器文档解析器(`Docparse/index.html`,约 1629 行),
以 zip 分发,用户双击 `index.html` 从 `file://` 打开,无需安装、无需服务器。

现有解析路径:

| 输入 | 引擎 |
|---|---|
| 有文本层的 PDF | pdf.js → `groupItemsIntoLines()` → `buildBlocks()` → `classifySection()` |
| 扫描件 / 图片 | PaddleOCR (onnxruntime-web,模型自 CDN 下载) → 同上 block 管线 |
| Excel / CSV | SheetJS |
| 字段抽取 | `extractFieldsFromBlocks()`(手写 "Label: value" 启发式) |
| Smart extract | 原生 PDF 发给 Gemini 2.5 Flash(经 Cloudflare Worker),只要字段 JSON |

**痛点:版面和表格理解差。** `classifySection()` 里几百行手写启发式(列聚类、
表格判定、折行合并)在真实商业文档(PO、服务合同、报价单)上经常猜错。

## 决策:用 Gemini 做版面解析,不引入 MinerU / Docling

MinerU、Docling、PP-StructureV3 是专门的版面/表格结构模型,在合并单元格的
表格保真度上大概率优于 Gemini。但不采用,理由:

1. 它们不做字段语义(「付款条件是什么」),仍需再过一次 LLM —— 等于维护两套系统。
2. 它们需要常驻的 GPU/CPU Python 推理服务,与「单文件客户端 + 一个无状态 Worker」
   的架构冲突,属于另一个基础设施品类。
3. 目标文档是港式电信合同 / PO / 报价单 —— 有边界的商业表单,不是带公式和复杂
   嵌套图表的学术论文。Gemini 把 OCR + 版面 + 语义合并在一次调用里对这类文档够用。

**后备方案**:若上线后合并单元格表格仍是主要问题,下一步是混合方案(轻量表格
区域检测 → 切图 → 再喂 Gemini),而不是整体更换引擎。

---

# Phase 0 — 安全加固(阻塞项,先做)

这一期与 VLM 功能无关,是修补**当前已经存在**的问题。必须在加大 Worker 流量前完成。

## 0.1 现状问题

`worker/worker.js` 是一个对外开放的 Gemini 代理:

- `worker.js:14-18` — `Access-Control-Allow-Origin: *`,无鉴权,无限流。
- `worker.js:38-47` — 仅校验 `Array.isArray(body.contents)`,**不限制 prompt 内容、
  part 数量、payload 体积**。
- `SMART_ENDPOINT` 明文写在 `index.html:1305`,随 zip 分发,任何人可读。

后果:任何拿到 zip 的人都能把它当作免费、不限量的 Gemini 2.5 Flash 通用接口使用,
账单计在本项目的 key 上。因为不约束 prompt,滥用不限于文档解析。

## 0.2 计费等级

已确认:key 所在的 Google Cloud project **已绑定 billing account(付费层)**。
付费层的 prompt/response 不用于训练,仅作短期滥用监控保留。

遗留注意事项(不阻塞,但需知晓):`generativelanguage.googleapis.com` 不提供
数据驻留保证(可能在美国处理),且无签署的 DPA。若第三方合同的保密条款要求
DPA 或数据驻留,正确的终点是 Vertex AI + 企业协议,而非本端点。

## 0.3 改动项

### A. Google Cloud 预算上限(控制台操作,非代码)

在 key 所属 project 上设置硬性预算上限 + 告警。这是前面所有措施被绕过时的最后一道保险。

### B. `worker/worker.js` 请求体校验

在现有的 `Array.isArray(body.contents)` 检查之外增加:

- 总 payload 字节上限(建议 20 MB,对齐 Gemini 的 inline 请求上限)
- `inline_data` part 数量上限(建议 20,对齐 `AI_MAX_PAGES` + 余量)
- `inline_data.mime_type` 白名单:`application/pdf`、`image/png`、`image/jpeg`、
  `image/webp`。其余拒绝。
- 文本 part 总长度上限(防止把它当纯文本 LLM 用)

拒绝时返回 400 + 明确原因,不透传给 Gemini。

### C. 限流

按 IP + 全局两层。实现选项(择一,实施时定):

- Cloudflare Rate Limiting 规则(控制台配置,零代码)
- Worker 内 Durable Object 计数器(代码,更灵活)

### D. Turnstile —— 先实测,失败则放弃

加 Cloudflare Turnstile(客户端取 token,Worker 侧 siteverify 校验)。

**风险点**:Turnstile widget 从 `file://` 打开的页面能否正常签发 token 未知。
Turnstile sitekey 绑定域名,而 `file://` 页面没有有效 hostname。

**已决**:先花时间实测。

- 能用 → 纳入 Phase 0,作为防滥用的主力层。
- 不能用 → 放弃,只做 A + B + C。届时那个洞是**收窄而非堵死**:
  限流挡住批量滥用,预算上限兜住最坏情况,但单个知道 URL 的人仍能在限额内
  白嫖。这是接受的残余风险,不是遗漏。

实测应在写任何 Worker 集成代码之前进行 —— 用最小的 `file://` 测试页验证
widget 能否签发有效 token,避免在不可行的路径上投入。

## 0.4 顺带修复(同一文件,零风险)

- `index.html:1450` — 400 和 403 被一起报成 `'Key rejected.'`。但 `usingWorker`
  恒为 true(`index.html:1305/1316`),当前所有用户根本没有 key 可被拒。400 更
  可能是 payload 问题。报错文案应按 `usingWorker` 分支。

---

# Phase 1 — VLM 版面解析

## 1.1 核心契约:让 Gemini 返回 app 已有的 block 形状

现有渲染器 `appendDocBody()`(`index.html:1030`)消费的形状:

```js
[{ pageNum, ocr, blocks: [
    { type: 'para',  lines: ["...", "..."] },
    { type: 'table', rows: [["Item","Qty"], ["Avaya","2"]] }
]}]
```

让 Gemini 直接产出这个形状。收益:

- 表格走现有 `<table>` 渲染,**不注入模型生成的 HTML**(`appendDocBody` 全程用
  `textContent`,见 `index.html:1049/1059`,XSS 面天然关闭)
- .txt/.csv/.json 导出、localStorage 历史、批量模式**无需改动**
- 本地引擎与 AI 引擎产出同一形状,可互相顶替

## 1.2 两次调用,不合并

字段抽取保持现状(已在跑、已可靠,不碰),正文解析作为**独立的、分批的**调用新增。

理由:原生 PDF 输入是固定 **258 token/页**(与内容无关),重发同一份 PDF 只多花
约 $0.001-0.004,可忽略。分开的收益是把已上线的可靠路径与新的高风险路径解耦,
正文调用可独立分批和重试。

(若日后确需合并,schema/prompt 中 `fields` 必须排在 `pages` 之前,使截断损失的
是尾部正文而非关键字段。)

## 1.3 分批策略

**每 5 页一批,并发发出,按 `pageNum` 客户端拼接。**

单次调用的可靠性随页数急剧下降(在触及 65,536 输出 token 硬上限之前,
指令遵循能力就先崩了):

| 页数 | 单次调用可用率 |
|---|---|
| 2-5 页 | 90-95% |
| 8-15 页 | 70-75% |
| 15-39 页 | 40-50% |

**实际语料分布(已向用户确认)**:常规文档在 10 页以内,偶尔出现 39 页的长合同。

按 5 页一批换算:

- 常规 10 页文档 → **2 批**,每批落在 90-95% 区间
- 39 页长合同 → **8 批**,同样每批落在 90-95% 区间,而非单次调用的 40-50%

这正是分批的价值所在:它把长文档从"大概率残缺"拉回到与短文档相同的可靠性区间。
若不分批,一份 39 页合同有一半概率静默丢页。5 页阈值确认适用,无需调整。

失败形态是**静默语义丢失**,不是报错:页数少于 `doc.numPages`、尾部页 blocks
为空或截断、rowspan/colspan 表格被拍平或重复。

**覆盖率校验**:解析后用 `max(pages[].pageNum)` 对比 pdf.js 的 `doc.numPages`。
有缺口视为需要重试该批次的信号,**不得当作静默的部分成功**。

### 原生 PDF 路径如何「分批」

pdf.js 只能读不能写,客户端切分 PDF 需要额外依赖(如 pdf-lib)。**不切分。**

每一批都发送**整份 PDF**,由 prompt 中的 "Pages N–M of {total} in this batch"
限定模型的输出范围。这样既不引入新依赖,也不必为了切页而栅格化(违反 1.9)。

代价是输入 token 随批次数线性增长,但输入是 258 token/页的 flat rate 且单价低廉:
39 页 × 8 批 ≈ 80k input token ≈ **$0.024**。输出量不变(每批仍只产出自己那 5 页),
而输出才是成本主导项。可接受。

图片输入(以及超过 `PDF_INLINE_MAX_BYTES` 而被迫栅格化的 PDF)则按页切分,
每批只发那一批的图片 —— 那条路径本来就是逐页图像,不存在这个问题。

## 1.4 `responseSchema`(必须,非可选)

现在客户端(`index.html:1442`)和 Worker(`worker.js:38-44`)都只设了
`responseMimeType` 和 `temperature`,没有 `responseSchema`。

光靠 prompt 文字描述这个嵌套判别联合,模型在真实负载下守不住。

**schema 必须硬编码在 Worker 里**(与 `temperature`/`responseMimeType` 同样处理),
不能由客户端传入 —— 否则重新打开 `worker.js:36-37` 特意堵上的开放代理洞。

```json
{
  "type": "OBJECT",
  "properties": {
    "fields": {
      "type": "ARRAY",
      "items": {
        "type": "OBJECT",
        "properties": { "label": {"type":"STRING"}, "value": {"type":"STRING"} },
        "required": ["label","value"]
      }
    },
    "pages": {
      "type": "ARRAY",
      "items": {
        "type": "OBJECT",
        "properties": {
          "pageNum": {"type":"INTEGER"},
          "blocks": {
            "type": "ARRAY",
            "items": {
              "type": "OBJECT",
              "properties": {
                "type": {"type":"STRING","enum":["para","table"]},
                "lines": {"type":"ARRAY","items":{"type":"STRING"}},
                "rows": {"type":"ARRAY","items":{"type":"ARRAY","items":{"type":"STRING"}}}
              },
              "required": ["type"]
            }
          }
        },
        "required": ["pageNum","blocks"]
      }
    }
  },
  "required": ["fields","pages"]
}
```

限制:Gemini 的结构化输出无法表达「table 必须有 rows / para 必须有 lines」这种
判别式 XOR,两者在 schema 里都是可选,**配对关系必须客户端事后校验**。

另设 `thinking_budget: 0` —— 这是确定性抽取任务(`temperature: 0` 已表明),
2.5 Flash 的 thinking token 计入输出预算,徒增延迟和成本。

## 1.5 客户端校验(逐 block 降级,不逐文档)

复用代码里已有的批量隔离哲学(`index.html:1217-1228`,一个坏文件不拖垮整批)
下沉一层:

- 显式校验顶层形状(`pages` 是数组、`fields` 是数组)。**不要**沿用
  `index.html:1459` 那种 `items.fields || items.data` 的嗅探式兜底,那本身就是异味。
- 逐 block:未知 `type` 直接丢弃;`para` 的 `lines` 强制为字符串数组,否则丢弃;
  `table` 的 `rows` 必须是数组的数组。
  **`appendDocBody` 的渲染循环(`index.html:1042-1054`)对 `row.forEach` 无防护**,
  畸形行会抛异常,再被通用 catch(`index.html:1473-1476`)变成
  "Cannot read properties of undefined..." 这种原始 JS 报错,直接呈给一个永远
  不会看 console 的用户。参差不齐的行要补齐,不要假设列数一致。
- 若 `pages` 整体缺失或畸形,**不要放弃 Smart extract** —— 回落到现有的、已验证的
  fields-only 路径。正文 block 是叠加在已上线能力之上的渐进增强,不是替换。
- 对 block / lines / rows 总数设上限,防止病态生成灌进 DOM 构建循环。

## 1.6 引擎透明度

必须复用现有的 `Page ${pageNum}` + `(ocr ? ' (OCR)' : '')` 标记模式
(`index.html:1038`),把每页实际由哪个引擎产出标在页面上。

从「AI 读懂了你的表格」静默降级到「启发式读错了你的表格」而不给任何屏幕信号,
比直接报错更糟 —— 本 app 的目标用户是双击打开、不看 console 的人。

## 1.7 接缝(最小改动,不重写)

当前无共享接口:`runBtn` 的 handler(`index.html:995-1015`)和 `runBatch` 的循环
(`index.html:1193-1208`)各自按扩展名内联分支、逻辑重复;而 `smartExtract()`
(`index.html:1382`)是完全独立的孤岛,只写 `fieldsTable`,从不写 `resultBody`。

抽出一个两处共用的函数:

```js
async function extractDocument(file, { engine, onStatus })
  -> { pageBlocksList, fields, engineUsed, warnings }
```

- 本地引擎 = 现有 `processPdf`/`processImage`/`processExcel` + `extractFieldsFromBlocks`
  包装成此形状
- AI 引擎 = Gemini 调用 + `normalizeAiResult(raw)`(1.5 的纯校验函数)包装成同一形状

下游 `appendDocBody` / `renderDocResults` / `renderFields` **无需改动**。

## 1.8 页数上限修复(现存 bug)

`AI_MAX_PAGES = 15`(`index.html:1306`)只在 `renderDocumentAsImages()`
(`index.html:1359`)中生效。原生 PDF 分支(`index.html:1414-1418`)只检查
`selectedFile.size <= PDF_INLINE_MAX_BYTES`,**没有页数检查**。

实证:`Document/Avaya_and_Nice_..._signed.pdf`(3.25 MB / **39 页**)今天就整份
送进去了。在 fields-only 的现状下风险尚可控;改成要正文结构后,输出量随页数
暴涨,截断风险正好落在页数最多、表格最复杂的文档上。

修复:在走 inline 分支前检查 `doc.numPages`,统一执行分批(1.3)。

## 1.9 栅格化策略

**永不主动栅格化 15 MB 以下的 PDF。**

- 原生 PDF:固定 258 token/页
- 栅格化 JPEG(scale 1.5, q0.85):约 4 个 768px tile/页 ≈ 1032 token/页,
  且**有损** —— 压缩噪点正好伤在小字上(签名栏、表格细字),即精度最要紧之处

仅在被迫时栅格化(PDF 超过体积上限,或输入本来就是图片)。

## 1.10 成本(2.5 Flash,输出 token 占主导)

| 场景 | 成本/份 |
|---|---|
| 5 页,仅字段(现状) | ~$0.0016 |
| 5 页,字段 + 正文 | ~$0.02 |
| 15 页,字段 + 正文 | ~$0.058 |

分批几乎不增加成本(输入是 flat rate),**为可靠性分批是免费的**。

定价需在实施时复核当前费率。

## 1.11 模型选择

2.5 Flash 为默认。

- **不用 2.5 Flash-Lite** 做正文解析:表格/版面精度和 CJK OCR 保真度明显更弱。
- **2.5 Pro 作为升级路径,非默认**:先跑 Flash(对占语料 90% 的 2-5 页文档又快又对),
  若 1.3 的覆盖率校验发现缺页/不完整,再静默用 Pro 重试该批次,然后才向用户报错。

## 1.12 批量模式并发

`smartExtract()` 当前显式拒绝批量(`index.html:1384-1388`)—— 这是有意的范围裁剪。

`runBatch()` 的顺序循环(`index.html:1180`)对**本地**引擎是正确的:PaddleOCR 是
共享单例(`_paddleOcr`,`index.html:529`)跑在单线程 WASM 上
(`ort.env.wasm.numThreads = 1`,`index.html:534`),并发只会争抢同一个 WASM 实例。

AI 引擎是网络受限、相反的特性。给它单独的小并发池(2-3 个在途),既不塞进顺序
循环,也不放开完全并发 —— 后者会对**共享的** Worker key 造成 429 风暴(注意现在
是所有分发副本共用一把 key,不再是每人一把)。

### ⚠️ Phase 1 落地前必须重算限流阈值

Phase 0 在 Worker 上设了**按 IP 20 次/分钟**的限流(`worker/wrangler.toml` 的
`[[ratelimits]]`)。该值是在「一次 Smart extract = 一个请求」的前提下定的。

Phase 1 的 5 页分批会打破这个前提:

- 一份 39 页合同 → 约 8 个请求
- 于是单个 IP 每分钟只够处理约 2.5 份长文档

而**限流按 IP 计,一间办公室通常共用一个出口 IP(NAT)**。两个同事在同一分钟
内各转一份长文档就会撞到 429 —— 被拦的是合法流量。

因此 Phase 1 实施时必须:

1. 按「预期并发用户数 × 每份文档的批次数」重新计算 `limit`
2. 客户端对 429 做带退避的自动重试,而不是直接把错误抛给用户 —— 分批本来就是
   为了可靠性,不能因为限流反而制造新的失败模式
3. 由于没有鉴权,IP 是唯一可用的限流维度;若共享 IP 的误伤无法接受,唯一的
   出路是引入某种用户标识(如 Turnstile 或轻量 token),即回到 Phase 0 跳过的
   那条路

## 1.13 Prompt

```
System:
You are a document layout and data extraction engine. You will be given
one or more pages of a business document (contract, purchase order, or
quote). Output ONLY JSON matching the provided schema — no markdown, no
commentary.

Rules:
- Preserve reading order top-to-bottom, left-to-right within each page.
- A "table" block is any grid of 2+ columns with 2+ rows of aligned data.
  Represent every visible row as one entry in "rows", including the header
  row as rows[0]. Every row must have the same number of cells as the
  header; if a cell spans multiple columns (a merged cell), repeat its
  text in each spanned column rather than leaving cells blank.
  If a multi-column PAGE LAYOUT (not a table) places unrelated text
  side-by-side (e.g. two independent paragraphs), do NOT merge them into
  table rows — emit them as separate "para" blocks in left-to-right order.
- A "para" block is prose or a labeled list that isn't a data grid. Keep
  each visual line as one entry in "lines"; merge a line that visually
  wraps from the previous line into that previous entry.
- Page headers/footers that repeat identically on every page (letterhead,
  page numbers, "Confidential") should appear once per page as they
  visually do — do not deduplicate them away, and do not skip a page
  because its header/footer looks like the previous page's.
- Labels and values may be in English or Chinese (Traditional or
  Simplified), sometimes both on the same line (e.g. "客戶名稱 Customer
  Name: ABC Ltd"). Keep the label in the document's own original wording
  and language; do not translate.
- "fields" is a flat list of every labeled field and key data point in the
  ENTIRE document (not per-page): reference/contract/PO numbers, dates,
  monetary totals, payment terms, To/From/Attn names, signature block
  names and titles. Do not invent values not present in the document.
- If a page is blank, a cover sheet, or contains only a signature/seal
  image with no extractable text, still emit it as
  {"pageNum": N, "blocks": []} — do not omit the page entry.

User:
Extract this document's structure and fields. Pages N–M of {total} in
this batch. [PDF or page images attached]
```

最后那条「空页也要输出 `{pageNum, blocks: []}`」直接针对 1.3 的丢页失败模式:
它把「页存在但 blocks 为空」和「页整个缺失」区分开,给客户端一个可判定的信号。

## 1.14 客户端 / Worker 版本偏移

本 app 以静态 zip 分发(`README.md:7`「unzip... keep all files together」),
**没有更新通道**,且 `usingWorker` 对所有当前接收者恒为 true —— 每个分发副本都
打到同一个线上 Worker。

Worker 的 prompt/schema 与 `index.html` 的必须原子性同步变更,但目前没有任何机制
保证这一点。旧 zip(fields-only)会持续打到行为已变的 Worker;新 zip(blocks)可能
打到尚未重新部署的旧 Worker。

**最小修复**:加一个 `schemaVersion` 字段,Worker 校验不匹配时明确拒绝(报错,
而非静默误解析)。README 中注明「重新部署 Worker」与「重新打包 index.html」是两个
必须同时进行的手动步骤。

## 1.15 文案诚实性

以下当前文案对走 Worker 路径的用户**已经是假的**(不是这次改动才导致的):

- `index.html:163`(lede):"Runs entirely in this browser... your documents never
  leave this computer."
- `index.html:226`(footer):"Files are only sent over the network if you choose
  to use 'Smart extract' with your own Gemini API key." —— 既不是"你自己的 key"
  (是共享 Worker key),措辞也误导。
- `README.md:46-47`:同样问题。

注:`index.html:193` 那句安抚性的 key-box 提示在 `usingWorker` 为 true 时已被隐藏
(`index.html:1319-1320`),但 lede 和 footer **没有**被这个 flag 约束,无条件显示。

替换文案(诚实但不制造恐慌):

- Lede:"...English and Chinese supported. Reading happens on this computer;
  'Smart extract' uploads the document to Google's Gemini API — see the notice
  below before using it on anything confidential."
- Footer:"Reading and OCR happen entirely on this computer. 'Smart extract'
  uploads the document to Google's Gemini API through a shared proxy. Do not use
  it on documents you're not authorized to share with a third-party AI service."

## 1.16 动作模型:两个按钮保持分离,不合并

即使 AI 解析成为实际主路径,也**不**合并 "Read document" 与 "Smart extract"。

理由(针对本 app 的信任契约,非泛泛的 UX 谨慎):

1. **成本意外**:本地 OCR 免费、零网络调用;Smart extract 上传文件并消耗配额。
   合并后的按钮首次点击就静默发起付费网络请求,当场让页面上的隐私声明变成谎言。
2. **认知**:两个按钮本身就是**当前唯一在教用户「哪个动作会把文件传出去」的
   UI 元素**。合并掉,用户就再无任何信号。
3. **权责分离**:配置 Worker 的操作者与双击 zip、喂进某份具体合同的终端用户是
   不同的人在做不同的风险决策,不能替后者默认选择上传。

替代方案(非维持现状):本地解析完成后,在字段表下方给一行上下文提示 ——

```html
<p class="ai-hint" id="smartExtractNudge">
  Fields look off?
  <button type="button" class="link-btn" id="tryAiBtn">Try Smart extract</button>
  for AI-assisted accuracy — uploads this file to Google.
</p>
```

免费路径永远可用,付费路径永远是显式的一次点击,但入口就在免费结果不够用的位置。

---

# Phase 2 — 左右分栏 UI

## 2.1 布局

新增 `#splitView` 网格,在结果产生前保持 `display:none`(沿用 `#results.show` 的
现有门控模式)。它突破 `.sheet` 的 920px 栏宽(散文/dropzone 保持窄栏,工作区加宽):

```css
#splitView {
  display: none;
  margin-top: 30px;
  border-top: 2px solid var(--ink);
  margin-left: calc(50% - 50vw + 12px);
  margin-right: calc(50% - 50vw + 12px);
  max-width: 1320px;
  width: calc(100vw - 24px);
}
#splitView.show { display: grid; grid-template-columns: 1fr 1fr; }
@media (min-width: 860px) {
  #splitView.show { grid-template-columns: 1.15fr 1fr; }
}
.split-pane {
  position: sticky;
  top: calc(12px + var(--tabs-h, 0px));
  align-self: start;
  max-height: calc(100vh - 24px);
  overflow-y: auto;
  background: var(--paper);
}
#previewPane { border-right: 1px solid var(--rule); padding: 18px 20px; }
#fieldsPane  { padding: 18px 20px; }
#resultTabs.show { position: sticky; top: 0; z-index: 5; background: var(--paper); padding-top: 4px; }
```

两栏各自 sticky + 独立 `overflow-y`。批量 tab 存在时,用一行 JS 设置
`--tabs-h`(`resultTabs.offsetHeight`),避免面板起始位置被 tab 条遮住。

```
┌────────────────────────────────────────────────────────────────┐
│ header / lede / Recent / dropzone / file-info / queue           │
│ Read document 按钮 · status · error                             │
├────────────────────────────────────────────────────────────────┤
│ [ file1.pdf | file2.csv | file3.png ]   ← #resultTabs,仅批量,sticky
├──────────────────────────────┬──────────────────────────────────┤
│ DOCUMENT (sticky,独立滚动)   │ FIELDS (sticky,独立滚动)         │
│                              │ [ Fields ] [ Full text ] ← 二级 tab│
│  ┌────────────────────┐      │ ┌──────────────────────────────┐ │
│  │ Page 1 [页面图像]   │      │ │ NAME :      John Smith       │ │
│  ├────────────────────┤      │ │ PO NO. :    PO-88213         │ │
│  │ Page 2 ...          │      │ │ ADDRESS :   221B Baker St    │ │
│  └────────────────────┘      │ └──────────────────────────────┘ │
│                              │ Smart extract · Copy · Download   │
└──────────────────────────────┴──────────────────────────────────┘
```

## 2.2 "Full text" 视图归属

放进右栏内部的**二级 tab**,与 "Fields" 并列 —— 不是独立区块、不是弹窗、不是叠在下方。

复用 `#resultTabs` 已建立的 mono 大写 tab 语汇,但在视觉上从属于它(下划线样式而非
方框),使用户不会把「哪个文件」(顶层,方框 tab)与「这个文件的哪个视图」(二级,
下划线 tab)搞混。

两个 toolbar 各自跟随自己的内容(即它们今天在 DOM 中所处的位置,只是被移动,没有
新建分组),因此切换只需 toggle `.pane-view`/`.pane-tab` 的 active class,约 6 行
委托点击处理,无需 JS 交换 toolbar 内容。

## 2.3 空状态

不设计「两个空盒子」—— 不让它们存在。`#splitView` 保持 `display:none` 直到一次
读取真正产出内容,与 `#results` 今天的行为一致。加载前的页面状态不变。

唯一需要设计的新状态是点击 "Read document" 到内容落地之间的间隙:左栏(页面图像)
通常比字段抽取先就绪,故图像一到就挂出 `#splitView` 并显示 `#previewPane`,
`#fieldsPane` 用与 `#statusText` 相同的点动画显示 pending 占位。

## 2.4 Excel / CSV 左栏

没有页面图像,不伪造。左栏直接渲染 `appendExcelBody()` 已经构建的**同一张解析表格**
—— 对表格文件而言「原文」与「全文」本就是同一个对象,这样展示是诚实的。

连带影响:右栏的 "Full text" tab 对这类文件冗余,隐藏之,并给预览栏加一行标签
说明它为何与扫描页不同。

另:`table.doc-table` 当前没有横向滚动容器,且是按旧的 920px 栏宽设计的,宽表格会
撑破更窄的预览栏。需在 `appendDocBody` 和 `appendExcelBody` 中把 `<table>` 包进
`<div class="table-scroll">`(`overflow-x: auto`)。

## 2.5 批量模式

**只有一排 tab,不是两排。** `#resultTabs`(现有组件,不改)位于 `#splitView` 上方,
同时驱动两栏 —— 点一个文件 tab 同时切换左栏的页面/表格和右栏的字段/全文。

避免两排 tab 都在回答「哪个文件」而产生不同步。具体做法是给每个文件建一个与现有
`.result-pane`/`pane-N` 平行的 `.preview-pane`/`preview-N`,在 `runBatch()` 今天
构建 pane 的位置(`index.html:1188-1191`)一并构建,并扩展 `showResultPane(i)`。

## 2.6 移动端(<600px)

分栏无法保留。`#splitView.show` 塌成单栏,且**一次只有一栏在布局流中**(不叠放 ——
叠放会把每个 PDF 页的 canvas 渲染两遍,在手机上既昂贵又无意义)。

用一个双按钮分段切换器(基于 `.pane-tab` 样式,不新建组件)切换,默认为 Fields
(手机用户来就是为了看这个),一次点击切到 Preview。切换器由
`matchMedia('(max-width: 600px)')` 监听器控制显隐,因为它还需要给面板 toggle
`.mobile-active`,单靠 CSS 不够。

## 2.7 字段行

`table.fields` 现有样式已经是对的(mono 大写标签 / 衬线值 / 行 hover / 点击编辑
outline),不改。用户想要的 `Label :` 读法用 CSS 生成,保持 DOM 为干净文本
(对 `copyFieldsBtn` 很重要,它从 JS 模型取 `f.label + ': ' + f.value`,不受影响):

```css
table.fields td.flabel::after { content: ' :'; }
```

批量模式的 File 列(`renderFields()`,`index.html:1264-1269`)不变 —— 在 1320px
最大宽度下右栏约 594px,三列(File 20% / Label 34% / Value 46%)仍可读。
`renderFields()` 整体无需改动。

---

# 附:同期顺带处理的现存问题

| 问题 | 位置 | 处理 |
|---|---|---|
| 400/403 都报 "Key rejected" | `index.html:1450` | Phase 0 顺带修 |
| `docparse_temp_key` 死代码 | `index.html:1321-1341` | **已决:整段删除。** 该路径当初只是作者自己贴 key 做测试用的便利通道,不是产品功能,无需保留为 Worker 宕机兜底。连同 key-box UI(`index.html:188-193`)、`#aiRow`/`#aiHint` 样式、`GEMINI_DIRECT_URL`(`index.html:1308-1309`)、`smartExtract()` 里的直连分支(`index.html:1436-1444`)、`usingWorker` 判断本身及其所有分支一并移除。移除后 Smart extract 只有 Worker 一条路径,代码里不再存在"哪条是活的"的歧义 |
| `appendExcelBody()` 的 `innerHTML` | `index.html:1100-1101` | `s.html` 来自 SheetJS `sheet_to_html()`,输入是用户本地 xlsx。若 SheetJS 未在所有情况下转义,恶意构造的表格可注入脚本,而该 DOM 有 clipboard 和 localStorage 访问权。需核实所打包 SheetJS 版本的转义行为,或改为手工 textContent 构表。**与 Gemini 改动无关,但别漏掉** |
| `docparse_history` 明文存储 | `index.html:1526-1555` | 最多 12 份文档的全文(每份 200KB 上限)明文存于 localStorage,无过期。共享电脑上是泄露面。建议改为可选、或加「这份不要保存」控件。"Clear" 按钮已存在(`index.html:166`) |

## 版本控制

本目录**不是 git 仓库**。建议在动 `index.html` 前 `git init` 存一版基线。

**注意**:`Document/` 里是 HKT / PCCW / AIA 的真实合同(带价格、服务号、签名)。
`git init` 前必须先写 `.gitignore` 排除 `Document/`,否则机密合同会进入 git 历史。

## 拆分为多文件(可选,Phase 1 或 2 顺带)

经典 `<script src>`(非 `type="module"`)在 `file://` 下正常工作 —— 只有
`type="module"` 会被 CORS 挡。app 对第三方库已经在用这个模式
(`index.html:229-233`)。

可拆为:`index.html`(标记+样式)+ `app.js`(状态/UI 接线)+
`layout-heuristics.js`(`groupItemsIntoLines`/`buildBlocks`/`classifySection`/
`extractFieldsFromBlocks`,约 350 行稳定代码)+ `ai-extract.js`(prompt 构建 /
`normalizeAiResult`)+ `history.js`。

机械操作,无需构建步骤。但任何新增的必需文件都要同时加进 `missingLibs` 守卫
(`index.html:240-251`)和 README 文件表(`README.md:14-19`),否则手工只复制
`index.html` 的用户会得到静默损坏,而不是现有的友好报错。
