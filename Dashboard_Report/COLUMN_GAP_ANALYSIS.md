# Step 1 — `admin_btb_lis_excel_datas` 欠缺嘅 Column（跨 admin 版本 LIS Excel 分析）

分析日期：2026-09-16
Master 定義來源：`Dashboard_Report/LIS_Excel/admin_btb_lis_excel_datas.xlsx`（sheet `query (1)`，59 columns）
Logical name 來源：`PR Assistant App.html` 嘅 `fetchRecordsFromDataverse` `$select`

---

## 0. 樣本一覽

| Admin 版本檔案 | Sheet | Header 列 | 欄數 | 性質 |
|---|---|---|---|---|
| `Up-to-date_PABX_Mtce_Base_FY2025-UCBV@20260908.xlsx` | `Yr2026(UCBV)` / `Yr2025(UCBV)` / `Yr2025(Avaya)` / `Blank Template` | R2+R3 兩層 | 32–42 | **Master 本身嘅原型**，格式最貼 |
| `BTB - AD & Logger Mtce 2026 (for CD37 & CB13).xlsx` | `2026` | R2+R3 兩層 | 29 | 同 UCBV 同一套 template |
| `BTB - Security Mtce 2026 (for C600).xlsx` | `2026` | R2 單層 | 31 | **另一套詞彙**，有 revenue / cost ratio |
| `Index for C556 C665 C65L.xlsx` | `C556 2025-2026` / `C665 2019-2026` / `EMPFA` | R1 單層 | 36 | **第三套詞彙**，Cisco/EMPFA，最多財務欄 |

⚠️ Excel 嘅「兩層 header」（R2 group + R3 leaf）已經 forward-fill 攤平先比對，唔係逐格字面對，所以 `Customer Signed Contract > Start Date` 認得出等於 master 嘅 `Start Date`。

---

## 1. 已經覆蓋 — 淨係叫法唔同，**唔使加**

呢啲喺 diff 入面顯示為 MISS，但其實 master 已經有同義欄。加多次只會令同一個值有兩個 column，dashboard 聚合時會雙重計算。

| Admin 版本叫法 | Master column | Logical name |
|---|---|---|
| `Agreement #` / `Agreement No.` | Contract No. | `admin_contractx0020nox002e2` |
| `PR #` / `PR#` / `line` | PR No. / No. | `admin_prx0020nox002e2` / `admin_nox002e2` |
| `PR Report Date` / `PR Issued Date` | PR Issued On | `admin_prx0020issuedx0020on2` |
| `PR Month` / `rec'd mth` | PR Issued Month | `admin_prx0020issuedx0020month2` |
| `PO #` / `PO#` | PO No. | `admin_pox0020nox002e2` |
| `PO Issue Date` | PO Date | `admin_pox0020date2` |
| `Description` / `DESCRIPTION` / `B2B Product type` | PR Description | `admin_prx0020description2` |
| `PR Amount HKD` / `PR Amt (HKD)` | HKD | `admin_hkd2` |
| `PR Amt (USD)` / `USD` | USD / Others | `admin_usdx0020x002fx0020others2` |
| `PO Total Amount HKD` / `PO Amt (HKD)` | PO Amount HK$ | `admin_pox0020amountx0020hkx00242` |
| `A/C` | Account Code | `admin_accountx0020code2` |
| `W.O.` | Works Order Code | `admin_worksx0020orderx0020code2` |
| `Receipt Date in LIS` / `Mark Recpt Date` | Receipt Date | `admin_receiptx0020date2` |
| `Job Start/End Date` / `Quote Mtce Period From/To` | Start Date2 / End Date3（BTB 採購期） | `admin_startx0020date2` / `admin_odatax0020endx0020date3` |
| `Customer Contract Mtce Period From/To` | Start Date / End Date | `admin_startx0020date` / `admin_odatax0020endx0020date2` |
| `SUPPLIER` | Vendor | `admin_vendor2` |
| `Case Handled By` | Handled By | `admin_handledx0020byx00202` |
| `Date to UM/Mgr` | UM/Mgr | `admin_umx002fmgr2` |
| `PR Approved by` | Approver | `Approver` |
| `Notes` / `remarks` | Remarks | `admin_remarks2` |
| `Invoice No./DN No.` / `INV#` | Invoice # / DN # | `admin_invoicex0020x0023x0020x002` |
| `INV date` / `Email Confirmation Date / Invoice Date` | Invoice / DN Date | `admin_invoicex0020x002fx0020dnx2` |
| `BTB / Non-BTB` | BTB_Type | `new_btb_type` |
| `Urgent BTB` / `Urgent Request Y/N` | Y / N | `admin_yx0020x002fx0020n2` |

---

## 2. 建議新增嘅 Column（**共 19 個**）

命名跟 master 較新嗰套 `new_*` snake_case 慣例（例如 `new_flagged` / `new_btb_type` / `new_quotation_expiry_date`），唔好再用舊嗰套 `admin_x0020` SharePoint encoding — 新欄冇歷史包袱，唔需要背嗰個債。

### P1 — 財務分析基礎（冇呢 3 個就做唔到 margin / 毛利趨勢）

| # | 建議 Logical Name | Display | Type | 來源 | 為咩要 |
|---|---|---|---|---|---|
| 1 | `new_revenue_hkd` | Revenue (HKD) | Decimal | UCBV `Contract Revenue`(n=205)、Security `Selling Amount HKD`(n=205)、Index `Total Revenue (1)`(n=378) | **三個 admin 各自有、master 完全冇。** 冇 revenue 就淨係得成本，dashboard 講唔到「賺唔賺」 |
| 2 | `new_direct_cost_hkd` | Total Direct Variable Cost (HKD) | Decimal | Index `Total Direct Variable Cost (2)`(n=378) | 同 `PO Amount HK$` **唔一定相等**（Index 兩欄並存），係真成本口徑 |
| 3 | `new_po_amount_usd` | PO Amount (USD) | Decimal | Security `PO Total Amount USD`、Index `PO Amt (USD)` | master 得 PR 側嘅 USD，PO 側只有 HKD |

> 有咗 1 + 3，`Ratio of Overall cost / revenue` 同 `Swapping / revenue` 可以喺 dashboard 即場計，唔使做 stored column（見 §3）。

### P2 — 分析維度（dashboard「唔同角度切」就係靠呢啲）

| # | 建議 Logical Name | Display | Type | 來源 | 為咩要 |
|---|---|---|---|---|---|
| 4 | `new_brand` | Brand | Text(100) | Security `Brand`(n=214：Palo Alto / Fortinet / Cisco / Juniper / Imperva / ManageEngine) | **最高價值嘅新維度** — 按品牌睇金額、增長、強弱 |
| 5 | `new_model` | Model | Text(500) | Security `Model`(n=141) | 多行文字，含 swap 金額備註 |
| 6 | `new_end_customer` | End Customer | Text(200) | Index `End Customer` | 我哋係中間方，`Customer Name` 同最終用家可以係兩個人 |
| 7 | `new_item_no` | Item # | Text(50) | Index `Item#`（"1-cisco" 等） | 對應 per-item PR 流程（見 CLAUDE.md 嘅 subject trailing bracket） |
| 8 | `new_quotation_no` | Quotation # | Text(100) | Index `Quote#`(n=217，數字/字串混) | master 完全冇報價單號；追 vendor quote 靠佢 |
| 9 | `new_buyer` | Buyer | Text(100) | Index `BUYER`(n=400) | 採購同事，同 `Handled By` 唔同人 |
| 10 | `new_ao` | AO | Text(100) | Index `AO`（Coey / Alice） | Admin Officer 分工維度 |
| 11 | `new_sb_contact` | SB / SO Contact | Text(200) | Security `SB in charge`、Index `SB & SO Contact Person` | 前線銷售，做「邊個 sales 帶嚟幾多生意」 |
| 12 | `new_sb_mtce_order_no` | SB Mtce Order # | Text(200) | Security `SB Mtce order #`(n=214) | 連返 SB 系統嘅單號 |

### P3 — 流程時間戳 / 單據號（做 cycle-time、積壓分析）

| # | 建議 Logical Name | Display | Type | 來源 | 備註 |
|---|---|---|---|---|---|
| 13 | `new_licence_receive_date` | Licence Receive Date | DateOnly | Security `Lic receive date`(n=190) | 純日期，乾淨 |
| 14 | `new_delivery_note_no` | Delivery Note # | Text(100) | Index `Delivery Note`(n=180) | 值混雜（`DN90006743` / `ETHKIF25003657` / `INV#60015754`），要 Text |
| 15 | `new_dn_date` | DN Date | DateOnly | Index `DN date`(n=181) | **建議由 master 嘅 `Invoice / DN Date` 拆出嚟** — 而家一個欄撈埋兩件事，做 lead-time 時分唔開 |
| 16 | `new_receipt_no` | Receipt # | Text(50) | Index `Receipt#`(n=62) | master 得 Receipt **Date**，冇號碼 |
| 17 | `new_customer_no` | Customer No | Text(50) | Avaya `Customer No` | Avaya service charge 專用客戶編號 |
| 18 | `new_prealert_month` | Pre-alert Month | DateOnly | Avaya `Pre-alert Month` | 續約提早預警月份 |
| 19 | `new_urgent_payment` | Urgent Payment | Text(300) | Index `Urgent payment`(n=7) | **值混日期同解釋文字**（`2025-03-12` vs `Yes (PO payment were withheld by G...)`），只得 7 條 → 一個 Text 欄夠，唔好硬砌 Date |

---

## 3. 建議**唔好**加嘅欄（連原因）

| Admin 版本欄位 | 唔加嘅原因 |
|---|---|
| `Ratio of Overall cost / revenue`、`Ratio of Overall Swapping / revenue` | 兩欄都被自由文字污染：214 條有 20 條係 `Committed Price` / `Refer to line 10` / `No breakdown`；另一欄 209 條有 **72 條**係文字（最長嗰句成段解釋）。存做數字欄會撈亂，存做文字又聚合唔到。**改為喺 dashboard 由 `new_revenue_hkd` 同 PO 金額即場計**，另加一個 `new_cost_ratio_note`（Text 500）收起啲人手註解 — 呢個係第 20 個建議欄，但屬「取代」而非「照抄」。 |
| `Site (HK/PRC/Others)`（Avaya） | 全表 190 行，只有 **1 格**有值，而嗰格仲係 `\xa0`（non-breaking space）。實質未啟用。 |
| `BTB status`（Security） | 只有 4 個值：`done` / `waiting book-in` / `waiting license delivery` / `waiting approval` — 即係 workflow 狀態。**唔好開新欄，應該加入現有 `new_process_status` 嘅 choice set**，否則同一件事兩個欄講，dashboard 要對兩次。 |
| `rec'd mth` / `PR Month` | 純粹由 `Rec'd Date` / `PR Issued On` 截月，dashboard 自己 group 就得。 |
| `PR Approved by` | master 已有 `Approver`。 |
| `Urgent BTB`、`BTB / Non-BTB` | 已有 `admin_yx0020x002fx0020n2` 同 `new_btb_type`。**但要清 value**：Index 嘅 `Urgent BTB` 有 `URGENT` / `SUPER URGENT` / `Suprer Urgent` / `Super Urgent` / `Urtgent` — 四五個串法指同一件事，入 master 前要 normalize 做 choice（`No` / `Urgent` / `Super Urgent`）。 |

---

## 4. Dashboard 需要、但**所有** admin Excel 都冇嘅欄（要新起）

呢幾個唔係「搬過嚟」，係 dashboard 要行得通就一定要補：

| 建議 Logical Name | Display | Type | 點解 |
|---|---|---|---|
| `new_cancelled` + `new_cancel_date` | Cancelled / Cancel Date | Boolean + DateOnly | UCBV 嘅 Totals sheet（`Yr2026-Total (UCBV)`）有 **`Nos Of Cancel Case`** 一欄，但 detail sheet **冇任何 column 標示取消** — 而家係靠 Excel 刪除線／底色人手標。呢個係純 formatting，搬入 Dataverse 會**整批消失**，取消個案會被當正常個案計入總額。 |
| `new_source_book` | Source Book | Choice | 分開 5 本簿：`UCBV` / `Avaya` / `AD & Logger (CD37/CB13)` / `Security (C600)` / `Index (C556/C665/EMPFA)`。`Charge CCC` 只喺 UCBV 系有欄，Security 同 Index **冇 CCC column**（本簿身份寫喺檔名度），所以唔可以淨靠 CCC 做維度。 |
| `new_fx_rate` | FX Rate (USD→HKD) | Decimal | USD 同 HKD 並存（PR 側、PO 側都有），冇匯率就做唔到統一幣種嘅趨勢線。 |

---

## 5. 總結數字

- Master 現有：**59** columns
- 建議新增：**19**（P1 3 + P2 9 + P3 7）
  - 加 `new_cost_ratio_note` 取代兩條 ratio 欄 → **20**
  - 加 dashboard 必需嘅 4 條（`new_cancelled`、`new_cancel_date`、`new_source_book`、`new_fx_rate`）→ **24**
- 明確建議**唔加**：7 類（ratio ×2、Site、BTB status、rec'd mth、PR Approved by、Urgent 兩欄）
- 合併後 master：**83** columns

---

## 6. 入 master 之前要做嘅資料清洗

1. `Urgent BTB` 串法統一（`Urtgent` / `Suprer Urgent` → choice）。
2. `Job Start Date`（Security）有 **datetime 同 str 混**，例如 `31-Dec-25\n29-Dec-25`（一格兩個日期）— 要人手拆或標記。
3. `Quote#`、`INV#`、`Delivery Note`、`Receipt#` 都係 **int/str 混** → Dataverse 一律用 Text，唔好用 Number（`60015876` 同 `WF12500205` 同一欄）。
4. `Total Revenue` / `Total Direct Variable Cost`（Index）有 `str` 型雜值（例如 `-`、`combine with C600 HKD8655.62`）→ 入 Decimal 前要撈走，文字落 `new_cost_ratio_note`。
5. 取消個案喺遷移前要先喺 Excel 標示出嚟（見 §4），否則失傳。

---

## 7. 呢啲欄一補齊，dashboard 即刻解鎖到嘅角度

| 角度 | 靠邊幾條新欄 |
|---|---|
| 毛利率趨勢（按月／季／年） | `new_revenue_hkd`、`new_direct_cost_hkd`、`PO Amount HK$` |
| 品牌強弱（邊個 vendor brand 增長／萎縮） | `new_brand`、`new_revenue_hkd` |
| Sales 貢獻排行 | `new_sb_contact`、`new_revenue_hkd` |
| Admin／AO 工作量同 cycle time | `new_ao`、`new_buyer`、`new_source_book` + 現有日期欄 |
| 流程瓶頸（PR→PO→Receipt→DN→INV 各段停幾耐） | `new_dn_date`、`new_receipt_no`、`new_licence_receive_date` + 現有日期欄 |
| 續約預警（未來 N 個月到期合約金額） | `new_prealert_month` + 現有 Start/End Date |
| 客戶集中度（真・最終用家） | `new_end_customer` |
| 跨簿比較（5 本簿橫向睇） | `new_source_book` |
