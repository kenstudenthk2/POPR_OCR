# OCR 邏輯講解頁（explainer）

`index.html` 係一版**自足**（self-contained）嘅解說頁：冇 CDN、冇 build、冇 npm，
雙擊就開得，同 `Docparse/` 一樣可以喺 `file://` 底下行。

## 點用

雙擊 `index.html`。頁頂有三個**閱讀深度**掣：

| 掣 | 對象 | 內容 |
|---|---|---|
| 🧒 細路版 | 8 歲上下 | 只有比喻，冇術語 |
| 🙂 普通版 | 一般同事、長輩 | 比喻 ＋ 點解要咁做、點樣攞到個值 |
| 🛠 工程版 | 改 engine 嘅人 | 以上全部 ＋ 函數名、`docparse-engine.js` 行號、每個常數同佢嘅出處 |

三個深度係**累加**嘅（細路 ⊂ 普通 ⊂ 工程），喺**同一頁**入面切換，唔會跳頁，
所以可以同一段落由細路版一路㩒到工程版睇。比喻永遠留低——
對長輩同啱啱入嚟嘅同事一樣有用。選擇會記入 `localStorage`。

## 加截圖

每個章節都留咗圖位（`figure.shot`）。圖位讀 `images/<slot>.png`；
搵唔到檔就會自動變成一格虛線提示，寫住應該擺乜嘢圖、檔名叫乜。

兩個方法擺圖：

1. **正式做法** — 將截圖改名放入 `images/`，重新整理頁面。
2. **即場試睇** — 直接將一張圖拖落個圖位，即刻預覽（只係今次開頁有效，冇寫入磁碟）。
   拖完個圖位會顯示要另存嘅檔名。

檔名一覽（全部放 `images/`）：

| 檔名 | 影乜 |
|---|---|
| `01-dropzone.png` | Docparse 首頁嘅拖放區 |
| `02-file-info.png` | 讀到檔之後嘅 Name / Type / Size 卡 |
| `03-full-text.png` | 「Full text」分頁，睇到還原出嚟嘅行 |
| `04-table-render.png` | 一個被認出係 table 嘅區塊，render 成真表格 |
| `05-detected-fields.png` | 「Detected fields」面板 |
| `06-ocr-status.png` | 掃描件行 OCR 時嘅進度／狀態列 |
| `07-signature-field.png` | Signature / Company Chop / Signature Block 欄位 |
| `08-atq-records.png` | 一張 ATQ 攤開成逐項記錄 |
| `09-quotation-match.png` | 記錄上嘅 Quotation Document（或「(no matching attachment)」） |
| `10-email-attachments.png` | 一封 `.msg` 讀出主體 + 每個附件 |
| `11-crosscheck.png` | PR Assistant 嘅跨文件核對畫面 |
| `12-export.png` | 匯出 CSV / JSON / TXT 嘅掣 |

## ⚠ 截圖唔可以用真嘢

`Demo Data/`、`Document/`、`_test/` 入面係**真實商業合約**（HKT / PCCW / AIA，
連價錢、服務號碼、客戶名同簽名）。呢啲一律唔可以入版本控制，
所以 `images/` 入面**唔准**出現由呢啲檔案生成嘅截圖。

安全嘅素材：

- `PR Assistant App.html` 入面手寫嘅 `DEMO_ATTACHMENTS`（全部係假嘢，`demo: true`）。
- 自己砌一份假文件再讀（假客戶名、假 `ATQ-250101-00001-V01` 之類）。
- 只影 UI 外殼、唔影內容嘅截圖。

呢版解說頁本身所有例子都係**虛構**嘅，冇一個數字出自 corpus。

## 改嘢注意

- 呢版嘅工程版內容引咗 `Docparse/docparse-engine.js` 嘅行號同常數值。
  改咗 engine 嘅常數，就要返嚟改附錄嗰張表，否則個表會呃人。
- 唔好加 CDN、唔好加 build step——同 `Docparse/` 一樣要 zip 咗照開得。
