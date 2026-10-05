# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Staff in **HKT · IPA PILLAR 1** who process purchase requisitions and purchase
orders. Their situation: a supplier or customer email arrives carrying several
attachments — a vendor quotation, an ATQ ("Authority to Quote") form (as the
workbook it was exported from, or as a PDF print of it, or both), a signed
agreement, and sometimes the customer's own purchase order. Their job is to
read what those documents say, satisfy themselves that the documents agree with
each other, transcribe the agreed values into a master record, and reply.

The work is document-bound and evidence-bound: the user is accountable for what
they transcribe, so every value the app shows must be traceable to the document
and page it came from. They are not passive readers of an automated result;
they are the reviewer who signs off on it.

## Product Purpose

Turn a pile of commercial attachments into a checked, transcribable record
without the user having to open each file and compare by eye.

Two apps share one engine:

- **Docparse** (`Docparse/`) — the shipping product. Read one document or a
  batch, get its full text, tables and a best-effort **Detected fields** list,
  correct any value, export CSV/JSON/TXT. Zip-distributed, double-click to
  open.
- **PR Assistant** (`PR Assistant App.html`) — the four-step workflow built on
  the same engine: **Upload & Parse → Verify → Master Records → Reply PR / PO**.

Success is that the user finishes a requisition faster *and* catches the
disagreement they would otherwise have missed — not that the app extracts
values unattended.

## Positioning

The cross-check compares **documents against each other**, not each document
against a form field. When the quotation, the ATQ, the agreement and the
customer PO all name a customer, an amount, a quotation reference and a
contract number, the app's claim is about whether those four sources agree, and
it names the file and page behind every side of the comparison. A neighbouring
OCR tool extracts fields from one document; it has nothing to say about whether
the pile is internally consistent.

Two supporting positions follow from that:

- **Honest about ignorance.** A page that was looked at and had nothing says
  "Not found"; a page never looked at is admitted to rather than counted as
  clean. Signature and company-chop detection is a reading of the pixels
  ("does this look signed"), never a verification ("is this signature
  genuine").
- **Nothing leaves the computer** unless the user clicks Smart extract. Parsing,
  OCR and cross-checking all run in the browser.

## Operating Context

- Runs on the user's own Windows machine in Chrome or Edge. Docparse is
  distributed as a zip and opened from `file://` — no install, no server, no
  account.
- Input is whatever the mail carried: PDF (text-layer or scanned), images,
  Excel/CSV, `.msg` / `.eml` with nested attachments. Scans arrive sideways and
  upside-down; OCR labels arrive misspelled; the same document commonly arrives
  twice, once clean and once as a signed scan.
- Documents fill four **roles** — Agreement, ATQ, Quotation, and the optional
  Customer PO — decided from a document's own first-page heading, then its
  filename, and reassignable by the reviewer. An empty Customer PO slot is a
  fact about the upload, not a fault in it.
- The destination is a spreadsheet with a fixed column order (A–Y), so the
  Upload page's "Copy for Excel" lays values out in exactly the position the
  destination expects.
- OCR recognition models (~30 MB) download from a CDN on first OCR use in a
  browser session, then cache.

## Capabilities and Constraints

Confirmed capabilities: batch parsing; table rendering; form-grid reading;
per-item ATQ records matched to their quotation attachment by filename;
label normalisation across attachments; signature / company-chop detection;
click-to-correct field values; CSV / JSON / TXT export; recent-files history in
local storage; optional **Smart extract** via Gemini behind a Cloudflare Worker
that holds the key server-side.

Durable constraints:

- **Build-free, install-free, zip-distributable, `file://`-openable.** No ES
  modules, no bundler, no npm dependency inside `Docparse/`.
  `PR Assistant App.html` follows the same rule (React + Tailwind + Babel from
  CDN, JSX compiled in-browser).
- **One shared engine.** `Docparse/docparse-engine.js` is consumed by both
  apps; a change there reaches both, and the App consumes keys Docparse never
  touches.
- **Detected fields are a heuristic, not AI.** Product copy must never present
  them as verified. The same goes double for Signature and Company Chop.
- Adding a required file to `Docparse/` means updating the `missingLibs` guard
  in `Docparse/index.html` and the file table in `Docparse/README.md`.

Undecided / open:

- **PR Assistant is destined to become a real product with a real backend.**
  Today it is wired to hand-written mock data (`DEMO_ATTACHMENTS`,
  `DEMO_RECORDS`), Master Records has no store, and Reply sends nothing. What
  the backend is, and whether the App keeps the `file://` constraint once it
  has one, are not decided.
- **A bilingual (English + 繁體中文) UI is required and does not exist yet.**
  The interface is English-only today; document *content* is already mixed
  English and Chinese and is not what this refers to. Which mechanism —
  toggle, side-by-side, or locale detection — is undecided.

## Brand Commitments

Name: **Docparse** for the reader, **PR Assistant** for the workflow app.
"HKT" and "PCCW" are the same side of the table and the app has no audience
outside HKT — the group's own name is a constant in the code, not one company
among many.

No formal brand guideline applies. The user confirmed this is an internal tool
with no obligation to follow HKT corporate identity; it needs to read as
professional and be comfortable for daily internal use.

## Evidence on Hand

- **Real corpus, never quotable.** `Demo Data/`, `Document/`, `_test/`,
  `Docparse/_*.html`, `base.json`, `new.json` and `*-fields.json` hold live
  HKT / PCCW / AIA agreements with pricing, service numbers, customer names and
  signatures. `.gitignore` covers them. No value out of them belongs in a
  commit message, PR body, issue, screenshot, or any tracked file — quote field
  *labels*, never values. This constrains every future demo, screenshot and
  marketing-shaped artefact.
- **Hand-written demo fixtures** live inside `PR Assistant App.html`
  (`DEMO_ATTACHMENTS` and friends): deliberately fake, each carrying
  `blob: null` and `demo: true`, with the same value spelled differently per
  document so the normalisers are what make the checks pass — plus two
  deliberate disagreements (a conflicting amount, a softened vendor name) so
  the cross-check is visible in a demo instead of a wall of green. These are
  the safe things to show.
- Behavioural spec: `Docparse/README.md`. Design/decision history:
  `docs/superpowers/specs/` and `docs/superpowers/plans/` (Chinese).
- No testimonials, customers, benchmarks, pricing or deployment claims exist.
  Future work must not fabricate any.

## Product Principles

1. **Show the source, not just the answer.** Every value is traceable to a
   file and a page; the reviewer decides, the app supplies evidence.
2. **Admit ignorance rather than round it into a clean result.** "Not looked
   at" and "not found" are different answers and must stay different.
3. **Documents are checked against each other**, never against an assumed
   correct form.
4. **The user's machine is the boundary.** Nothing is uploaded without an
   explicit click, and that click is always visible.
5. **Zero-friction distribution beats capability.** A feature that breaks
   double-click-to-open is not a feature.

## Accessibility & Inclusion

No formal standard was established. One product-specific requirement is
confirmed: the interface must eventually serve users working in English and in
繁體中文 (see the open decision above).
