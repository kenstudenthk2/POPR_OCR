# Docparse — click-to-open document reader

No server, no Docker, nothing to install.

## Setup

1. Unzip this into any folder — keep all files together.
2. Double-click `index.html`. It opens in your default browser.
3. Drop in a PDF, image, or Excel file — or drag a mail straight out of
   classic Outlook (see below for the new Outlook).
4. Click **Read document**.

## What's in this folder

| File | Purpose |
|---|---|
| `index.html` | The app itself — double-click this. Presentation only: it reads files through `docparse-engine.js` |
| `docparse-engine.js` | All the parsing (PDF, OCR, Excel, `.msg`/`.eml`, field detection). Shared with `../PR Assistant App.html`, so a fix here reaches both |
| `pdf.min.js` / `pdf.worker.min.js` | Reads PDF files (bundled, works offline) |
| `xlsx.full.min.js` | Reads Excel files (bundled, works offline) |
| `paddle-ocr.min.js` | OCR engine for scanned pages/images — English + Chinese, wraps the official PaddlePaddle/PaddleOCR PP-OCRv6 models via `ppu-paddle-ocr` |

## What it does

- **Excel** reads directly — no OCR, it's already structured data. Labelled
  cells become detected fields the same way a PDF's do, so a quotation
  attached as a workbook answers the same questions as the same quotation
  attached as a PDF. Data tables are recognised as tables and left out of the
  field list rather than pairing their column headers with each other.
- **PDF** reads real text directly when present; scanned/image-only pages
  fall through to OCR automatically.
- **Images** always go through OCR.
- **Sideways and upside-down scans** are handled: when a scanned page comes
  back with low recognition confidence, the page is re-read at 90°, 180° and
  270° and the best result kept. Orientation is decided once per document and
  reused for its remaining pages.
- **Long scans** stop cleanly. If OCR is still going after a couple of
  minutes it stops at the current page and keeps everything read so far,
  rather than losing the whole attachment — the unread pages are marked in
  the text and the document is flagged as partly read.
- **Signatures and company chops are detected.** A signed agreement and the
  blank one sent out for signing contain exactly the same words, so the
  difference is looked for in the ink instead: a handwritten signature is
  one sprawling stroke far larger than any printed character and mostly
  empty inside its own outline, and a chop is a closed ring, oval or
  rubber-stamp frame, usually red or blue but recognised in a photocopy
  too. Both are reported as fields — **Signature**, **Company Chop**, and
  **Signature Block** for a document that has somewhere to sign — with the
  page they were found on.

  Three things it deliberately will not call a signature: ink that the
  PDF's own text layer says is typed (so the printed words "Authorised
  Signature" under an empty line stay off an unsigned quotation), a row of
  pieces sharing one baseline and one size (a heading), and warm-coloured
  artwork (a magenta wordmark is not a pen). One consequence worth knowing:
  a signature set in a *script font* rather than written by hand counts as
  typed text and is reported as **Not found** — which is the honest answer
  to "has anyone signed this", but not the one a glance at the page gives.

  It is a heuristic on the pixels, not a verification: it answers "does
  this look signed", never "is this signature genuine". A page that was
  looked at and had nothing says "Not found"; pages never looked at are
  admitted to rather than counted as clean. Looking at a page means drawing
  it, and a few form templates take several seconds each to draw, so a
  document can run out of the time budget part-way. The pages that mention
  signing are drawn first, then the last pages, so whatever does get
  skipped is the least likely to have been signed.
- **Forms are read as forms.** Most of a form is a grid, and a grid is where
  its answers live — "Customer Number | 82332954 | Customer Name | HOSPITAL
  AUTHORITY" is four fields, not a table to look at. Three grid shapes are
  read for fields: columns that alternate label and value, a column of
  figures read against the labels beside it (an amount keeps the percentage
  printed next to it, so Gross Profit reads "$251,356.45 (35.12%)"), and a
  single record written across under its headings. Everything else — a list
  of uploaded files, a list of approvals — is data, and is shown as a table
  rather than flattened into fields.

  Some of a form's rows separate label from value by nothing but column
  position. Those are read too, but only where the label is one this app
  already knows, because "Project Description   Maintenance Service for…"
  and "Proposed New Contract   Previous Contract" are otherwise the same
  shape, and the second one is a heading.
- **ATQ ("Authority to Quote") forms** produce one record per purchased
  item — item number, product and service type, vendor, back-to-back flag,
  value, quotation reference and remark — plus the form's own contract
  fields. This works whether the ATQ arrives as the workbook it was
  exported from or as a PDF print of it: both produce the same records, so
  nothing downstream has to care which one the email carried.
- **Emails** (`.msg`/`.eml`) read the message plus every supported
  attachment. An ATQ attachment becomes one record per costed item, and
  each record's `Quotation` reference is matched by filename to the
  attachment that holds that quotation — shown as **Quotation Document**,
  or "(no matching attachment)" when the email doesn't carry it. Matching
  is on the filename only; the quotation itself isn't read.
- **A mail can be dragged straight out of classic Outlook** onto the drop zone,
  with no need to save it to the desktop first. This needs saying because the
  mail is not a file: it lives in your `.ost`/`.pst` or on Exchange, and classic
  Outlook offers it to the browser as a *virtual* file. Chrome and Edge pass
  that on, and the mail is then read exactly as a saved `.msg` would be,
  attachments included. Dragging a single attachment out of an open mail works
  the same way and keeps its own file type.

  **The new Outlook for Windows does not do this.** It does not hand mails to a
  browser at all, so a mail dragged from it arrives as text with no file
  attached — the app says so rather than sitting there doing nothing. The route
  that does work there: drag the mail to the desktop (new Outlook saves `.eml`,
  not `.msg`), or use **More actions → Save as**, then drop the saved file.
  `.eml` and `.msg` are read the same way, so nothing downstream changes.
- **Batch mode** — drop in several files at once. Each is processed in
  order; one bad file won't stop the rest. Detected fields from every file
  land in one combined table with a File column.
- **Field names are normalised across attachments.** The same document often
  arrives twice in one email — a clean copy and a signed scan of it — and OCR
  spells the scan's labels differently ("Equlpment Liat" for "Equipment
  List"). Labels are snapped onto a canonical spelling, and a scanned
  attachment's words are additionally checked against the attachments in the
  same email that needed no OCR, so both copies answer under the same field
  names. Numbers are never rewritten this way: a quotation reference that OCR
  misread stays as it was read rather than being "corrected" into a different
  reference.
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
  That goes double for **Signature** and **Company Chop**: they are a
  reading of the pixels meant to be confirmed by a person, never a
  substitute for looking at the page.
