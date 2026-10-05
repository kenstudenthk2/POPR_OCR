# PRPO.pen 重建設計 —— 由 App 現況倒推，做成可改嘅設計工作面

日期：2026-08-15
分支：`feature/deferred-ocr-process-verify-flow`

## 目的

`PRPO.pen` 只有一個 commit（`c224f63`，2026-07-30），停留喺最初嘅版面探索階段。
之後 `PR Assistant App.html` 行咗五個 commit，多咗三個設計檔完全冇畫過嘅畫面。

呢份 spec 唔係為咗補文件。目的係**攞返一個可以改設計嘅工作面**：先喺 Pencil 入面
如實重建 App 現時嘅介面，之後所有版面同視覺改動喺 `.pen` 度做，唔係喺 HTML 度撞。

因此「圖層改唔改得動」比「幾快落到畫布」重要。呢個判斷決定咗下面所有取捨。

## 已鎖定嘅決定

| 項目 | 決定 |
|---|---|
| 同步方向 | App → `PRPO.pen`（以程式碼現況為真相來源） |
| 精細度 | 高保真 |
| 狀態範圍 | 只畫主狀態 |
| 舊 frame | 六個 Jul 30 探索稿全部刪走 |
| 做法 | 方案 B —— 擷取真實數值做量度，但用 auto-layout + reusable component 手砌乾淨圖層 |
| 試金石 | `01 Upload & Parse`，砌完交審，滿意先做其餘 |
| Frame 數 | 9 |

### 為何唔直接 import DOM

Pencil 內置瀏覽器可以 `import-to-canvas` 直接把頁面落畫布，像真度自動最高、亦最快。
但落嚟係 DOM 形狀嘅圖層：幾十層 div 巢狀、絕對定位、命名係 class 名、冇 auto-layout。
改一個版面要喺圖層樹入面挖好耐，而且郁一樣嘢唔會帶動旁邊 —— 正正撞死本專案嘅目的。
所以瀏覽器只用嚟量度（`return-element` / `return-screenshot`），唔用嚟交付圖層。

## 非目標

- 唔改 `PR Assistant App.html`。呢輪只出設計檔。
- 唔畫 empty / loading / error / conflict 等次要狀態。
- 唔做 `.pen` → 程式碼嘅回寫。設計改完點落返 App，係之後另一份 spec 嘅事。

## 硬約束

1. **`PRPO.pen` 係 tracked file。** frame 入面只准填 App 自己嘅 demo 資料
   （`DEMO_ATTACHMENTS`，`ABC Company Ltd` / `QT-2600008` / `ATQ-202604-00177` 等虛構值，
   已經 commit 咗喺 HTML）。**嚴禁**用 `Demo Data/`、`Document/`、`_test/` 或任何真實
   電郵、合約、客戶名、服務號碼、價格填 frame 或截圖入 `.pen`。
2. **本機 shim 唔准 commit。** App 嘅 script 標籤指向 `admin_Docparse/`（Dataverse
   publisher prefix），repo 入面實際係 `Docparse/`。要喺本機開得起個 App，需要一個
   `admin_Docparse` → `Docparse` 嘅本機副本或連結；佢必須留喺 `.gitignore` 之外唔入版本庫。
3. **唔准 merge / rebase / force-push** 呢條分支同 `origin/main` 之間任何一邊
   （見本分支 `CLAUDE.md`「兩條分岔線」一節）。
4. Pencil MCP 嘅 `filePath` 參數係被忽略嘅 —— 所有呼叫都打去 app 當前開住嘅文件。
   動手前必須確認 active document 係 `PRPO.pen`。

## 設計基礎

### 顏色

全部由 `PR Assistant App.html` 抽出，並非估算。

| Token | 值 | 用途 |
|---|---|---|
| `sand` | `#F3EBE2` | 頁面底色、未選中 chip、raw text 面板底 |
| `sand-hi` | `#FBF0E8` | 選中狀態表面、拖放區底 |
| `sand-hover` | `#e9ddd0` | sand 按鈕 hover |
| `accent` | `#D4916E` | 主色：active 導航、主按鈕、focus 邊、進度條 |
| `accent-deep` | `#c47f5b` | drag-over 邊框 |
| `ink` | `#1A1A1A` | 正文字色，同時係 Sidebar 底色 |
| `ink-2` | `#3D3D3D` | 次級標題 |
| `muted` | `#6B6B6B` | 輔助文字 |
| `line` | `#C5BEB6` | 邊框、未完成圓點、捲動條 |
| `ok-text` | `#3D8B5F` | 成功文字、已完成圓點 |
| `ok-pill` | `#E8F5EC` | 成功 pill 底 |
| `ok-field` | `#EAF5EC` / 邊 `#9FD9B8` | 自動擷取欄位底 / 邊 |
| `warn` | `#B78312` / 底 `#FDF6E0` | 警示文字·左邊條 / 底 |
| `danger` | `#C0392B` / 底 `#FDECEB` | 錯誤文字·左邊條 / 底 |
| 深色上文字 | `#FFFFFF` @ 10 / 25 / 30 / 35 / 45 / 60 / 80 % | Sidebar 內部層級 |

### 字體

三套字體各有分工，係成個介面性格所在，改設計時應該保住：

- **Funnel Sans** 600/700 —— 標題。頁標題 24、卡標題 16、Sidebar 品牌 18。
- **Inter** 400–700 —— 介面本體同資料。13 正文、12 標籤、11 meta。
- **Newsreader**（襯線，含斜體）—— **解釋性文字**：TopBar 副題 13、提示同圖例 11–12、
  raw text 面板 11/18。

即係：襯線體講「解釋」，無襯線講「資料」。

字級：10 / 11 / 12 / 13 / 15 / 16 / 18 / 24 / 30。
字距：Sidebar 單位標籤 2px、Sidebar 分區標籤 1.5px、卡分區標籤 1px。

### 幾何

- 圓角：6（輸入框）/ 8（警示條、導航項）/ 12（拖放區）/ full（chip、pill、進度條）
- 邊框：**1.5px 係招牌寬度**；拖放區 2px；警示條左邊 3px
- 間距：4px 基數，常見 gap 8 / 10 / 12 / 14 / 16 / 20 / 24
- 版面：Sidebar 240 固定、右欄 280 固定、內容左右 padding 32、卡 padding 20 或 24

## Component library

`.pen` 現時 zero reusable component，以下九個全部新建：

| Component | 變體 / 內容 |
|---|---|
| `Sidebar` | 品牌塊、WORKFLOW 導航（4 項）、CURRENT RECORD 鍵值列 + 進度條、New Record 按鈕 |
| `TopBar` | 標題（Funnel 24）+ 副題（Newsreader 13 muted）+ 右方插槽 |
| `Card` | 白底表面，兩種 padding（20 / 24） |
| `Button` | Primary / Ghost / Pill |
| `ChipTab` | 選中（`sand-hi` 底 + `accent` 邊字）/ 未選中（`sand` 底 + `line` 邊、`muted` 字）；可選前置狀態圓點 |
| `FieldBox` | 自動擷取（`ok-field` 底 + `#9FD9B8` 邊）/ 已編輯（白底）；下方來源膠囊 ✓ joined、≠ split、plain |
| `AlertStrip` | warn / danger 兩色，左 3px 邊 |
| `Dropzone` | 常態 / drag-over（邊轉 `accent-deep`）|
| `RoleSlotBar` | 四個角色膠囊 + 編輯入口 |

## Frame 清單

九個 frame，寬 1440，一行由左至右排，命名帶編號等圖層樹自然排序：

| Frame | 對應程式碼 |
|---|---|
| `00 Foundations` | 色卡、字階、九個 component 陳列 |
| `01 Upload & Parse` | `UploadPage`（`PR Assistant App.html:3053`）—— 試金石 |
| `02 Processing` | `ProcessingPage`（`:4608` 掛載） |
| `03 Extracted Fields` | `ExtractedFieldsPage`（`:3544`） |
| `04 Verify` | `VerifyPage`（`:3658`） |
| `05 Master Records` | `RecordsPage`（`:3941`） |
| `06 Reply` | `ReplyPage`（`:4055`） |
| `07 Document Viewer` | 檢視器 modal（`:2436`–`:2803`） |
| `08 Sidebar Nav` | `Sidebar`（`:2079`）自己嘅狀態攤開 |

`08 Sidebar Nav` **係新畫嘅**，唔係保留 Jul 30 嗰個舊探索稿（舊稿照樣全刪）。
佢同 `00 Foundations` 分開嘅理由：Foundations 展示 component 靜態外觀，
`08` 展示 Sidebar 喺四個導航項各自 active 時嘅樣，加上進度條 25 / 50 / 65 / 75 / 100% 嘅變化。

注意：`NAV_ITEMS` 只有四項（Upload & Parse、Verify、Master Records、Reply PR / PO）。
`processing` 同 `extracted` 兩頁**唔喺導航入面**，係流程中間態，只能經 Process 按鈕到達。
`08 Sidebar Nav` 必須反映呢點，唔好自作主張補多兩個導航項。

Frame 高度跟內容走（Upload 頁約 1900–2200），**唔跟視窗高度** —— 呢啲頁本身要捲動，
切到視窗高會斬走成半版嘢。

每個容器用 Pencil auto-layout 對應返原本嘅 flex：方向、gap、padding 照抄。

## `01 Upload & Parse` 拆解（試金石）

TopBar：標題 `Upload & Parse`，副題
`Drop attachments to auto-extract PR fields. PDFs read directly; scanned files use OCR.`
右方三件：綠 Pill `{已解析數}/5 attachments`（數字照 demo mode 實際顯示嘅嚟填，唔好自己作）、
Ghost `✓ Demo`、Primary `Process →`。

主體 `flex gap-24 px-32 pb-32 items-start`，兩欄。

**左欄**（flex-1，直向 gap 20）

1. `Card` p-20：分區標籤 `ATTACHMENT TYPE`，下面五個 `ChipTab` —— Vendor Quotation、
   Customer PO、Contract、ATQ、Excel。每個前置狀態圓點：已解析 `ok-text`，未解析 `line`。
2. `Dropzone`：📎 30px、主字 15 semibold `accent`、兩行 Newsreader 12 提示
   （格式清單、Outlook 拖放說明）。
3. `Card` p-24 `Extracted Fields`：
   - 標題行：卡標題 / 置中 `RoleSlotBar` / 右方圖例方塊 + Ghost `📋 Copy for Excel`
   - 圖例行（Newsreader 11）：joined、split、plain 三種讀法
   - Item tabs（ATQ 覆蓋多個 item 時先出現）
   - 首行欄位：`recordNo` 窄（80）+ 其餘（144）
   - 之後每行三個 `FieldBox`
4. 兩張並排 `Card` p-24：
   - `To Supplier Remark` —— Case Type chip（C716 / Others）+ 11 行 textarea
   - `BTB Remark (To Buyer)` —— Sales Contact 下拉 + 11 行 textarea

**右欄**（280 固定，直向 gap 16）

1. 附件狀態卡
2. 電郵文件卡
3. `RAW EXTRACTED TEXT` 卡：120 高捲動區（`sand` 底、`line` 邊）+ `Re-detect fields` 按鈕
4. warn `AlertStrip`：`Fields turn white once edited. Green = auto-extracted — always verify before proceeding.`

## 工作流程

1. 建本機 shim（`admin_Docparse` → `Docparse`），起 localhost，喺 Pencil 內置瀏覽器載入 App，
   開 demo mode。**唔 commit shim。**
2. 確認 Pencil active document 係 `PRPO.pen`。
3. 建 `00 Foundations`：token 色卡、字階、九個 component。
4. 砌 `01 Upload & Parse`，全部由 component 組裝。
5. **交審。** 滿意先做其餘七個 frame。
6. 刪走六個舊 frame（留到最後至刪，等對照仲有得睇）。

## 驗證

每個 frame 砌完，用 `return-screenshot` 擷取對應畫面，同 `get_screenshot` 攞 canvas 圖，
兩者並排比對顏色、字級、間距、對齊。唔靠肉眼記憶。

## 風險

- **Pencil auto-layout 同 CSS flex 未必一一對應。** 遇到對唔上嘅地方，以視覺結果為準，
  並喺 frame 加註記，唔好為咗遷就工具而扭曲版面。
- **Upload 頁密度高。** 如果一個 frame 砌到失控，可以把 `Extracted Fields` 卡抽做獨立
  component，但唔應該拆做另一個 frame —— 拆咗就睇唔到成頁嘅比例關係。
- **試金石失敗嘅出路：** 如果 `01` 砌完發現手砌成本遠高於預期，改行方案 C
  （先 import 再清理）比硬撐落去好；呢個決定喺交審嗰刻做。

## 未決

- 設計改完之後點落返 `PR Assistant App.html` —— 另一份 spec。
- `untitled.pen` 點處理。佢同 `PRPO.pen` 同樣 tracked、內容唔同、來歷不明，本輪不動。
