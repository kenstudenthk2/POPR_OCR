# Docparse — click-to-open document reader

No server, no Docker, nothing to install.

## Setup

1. Unzip this into any folder — keep all files together.
2. Double-click `index.html`. It opens in your default browser.
3. Drop in a PDF, image, or Excel file.
4. Click **Read document**.

## Offline OCR

Document parsing runs locally in the browser. The OCR runtime is bundled in
`paddle-ocr.min.js`; model files are cached in the browser Cache API after the
first successful OCR initialization, so later OCR can continue without a
network connection.

For a guaranteed first-run offline deployment, provide local model assets
before loading `docparse-engine.js`:

```html
<script>
  window.DocparseOcrConfig = {
    model: {
      detection: './models/detection.ort',
      recognition: './models/recognition.ort',
      charactersDictionary: './models/dictionary.txt'
    }
  };
</script>
```

The existing CDN model remains the default when this configuration is absent.

## What's in this folder

| File | Purpose |
|---|---|
| `index.html` | The app itself — double-click this. Presentation only: it reads files through `docparse-engine.js` |
| `docparse-engine.js` | All the parsing (PDF, OCR, Excel, `.msg`/`.eml`, field detection). Shared with `../PR Assistant App.html`, so a fix here reaches both |
| `pdf.min.js` / `pdf.worker.min.js` | Reads PDF files (bundled, works offline) |
| `xlsx.full.min.js` | Reads Excel files (bundled, works offline) |
| `paddle-ocr.min.js` | OCR engine for scanned pages/images — English + Chinese, wraps the official PaddlePaddle/PaddleOCR PP-OCRv6 models via `ppu-paddle-ocr` |

## What it does

- **Excel** reads directly — no OCR, it's already structured data.
- **PDF** reads real text directly when present; scanned/image-only pages
  fall through to OCR automatically.
- **Images** always go through OCR.
- **Emails** (`.msg`/`.eml`) read the message plus every supported
  attachment. An ATQ workbook attachment becomes one record per costed
  item, and each record's `Quotation` reference is matched by filename to
  the attachment that holds that quotation — shown as **Quotation
  Document**, or "(no matching attachment)" when the email doesn't carry
  it. Matching is on the filename only; the quotation itself isn't read.
- **Batch mode** — drop in several files at once. Each is processed in
  order; one bad file won't stop the rest. Detected fields from every file
  land in one combined table with a File column.
- A **Detected fields** panel gives a best-effort list of labeled fields
  (e.g. "Contract Number → C159040"), works for English and Chinese labels.
  Click any value to correct it before exporting — corrections aren't sent
  anywhere, they only affect the export.
- Export fields as **.csv or .json**, full text as **.txt**, or copy either
  to the clipboard.
- Tables render as real tables, not flattened text.
- **Recent files** — the last dozen results (extracted text + fields, not
  the original file) are kept in this browser's local storage so closing
  the tab doesn't lose them. Nothing here is uploaded anywhere; "Clear"
  wipes it.

## Network use

- OCR needs its recognition models (~30 MB), which download from a CDN the
  first time OCR actually runs in a browser session, then stay cached.
  Your documents themselves never leave the computer for this — PDF, Excel,
  and OCR/full-text reading all work with no internet connection after that
  first model download.
- **Smart extract** (optional) sends the document to Google's Gemini API for
  higher-accuracy field extraction. It works out of the box — click
  "Smart extract" and it goes — see below.

## Smart extract (optional, higher-accuracy field extraction)

The "Smart extract" button asks Gemini to read the whole document and pull
out every labeled field as structured data — more accurate than the
heuristic "Detected fields" panel, especially for messy scans or unusual
layouts.

To use it:

1. Open a document, click **Read document**, then **Smart extract**.

That's it — no key to get, paste, or manage. Requests go through a small
Cloudflare Worker that holds one shared Gemini API key server-side, so end
users never see or handle a key.

PDFs are sent to the Worker as-is (native PDF understanding, tables and
layout included); images go as image data. Nothing is sent anywhere until
you click the button.

### Deploying your own Worker (for whoever distributes this app)

The `worker/` folder holds the Cloudflare Worker that Smart extract talks
to. If you're setting up a fresh copy of this app for distribution:

1. `cd worker && npx wrangler deploy`
2. `npx wrangler secret put GEMINI_API_KEY` (paste your key when prompted —
   it stays on Cloudflare, never in this app)
3. Put the deployed URL into `SMART_ENDPOINT` near the bottom of
   `index.html`, then redistribute the folder.

End users of the distributed app never see this step or interact with
Gemini directly — it's a one-time setup for whoever hosts the app.

## Notes

- Works best in Chrome or Edge.
- To share with others, zip this whole folder so every file travels
  together — `index.html` alone won't work without its neighbors.
- The "Detected fields" panel is a best-effort heuristic, not AI — always
  cross-check against the full text shown below it for anything important.
