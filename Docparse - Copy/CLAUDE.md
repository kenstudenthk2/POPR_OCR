# Docparse engine — verification notes

`docparse-engine.js` is shared, dependency-free, and loaded as a plain
`<script>` by two consumers: `Docparse/index.html` (two-argument
`parseFile(file, setStatus)` call) and `PR Assistant App.html` (three-argument,
passes `opts` for `deferOcr`/`retainForResume`/etc). See the root `CLAUDE.md`
for the compatibility rule between them.

## Why verification needs three layers

No single layer here covers the whole engine, and each one lies about something
if you rely on it alone:

**Node (`_test/_test/harness/`, automatic, run on every engine change)**
covers the text-layer PDF path, the layout pass (`groupItemsIntoLines`,
`buildBlocks`, `summarizePages`), and the Excel/ATQ workbook path — see
`_test/_test/harness/README.md`. It runs `ab-dump.js` before/after an engine
change and diffs with `ab-diff.js`; a clean run is **LOST 0, no differences**.
It explicitly does **not** touch scanned-page OCR: pdf.js's text-layer
extraction runs fine under Node, but there is no OCR model to run against a
scanned page, so any change that could alter OCR output is invisible here.

**Browser, manual — the browser ladder**

Node coverage stops exactly where OCR starts. To verify anything touching
`processPdf`'s OCR branch, `processImage`, ink/signature detection quality, or
the deferred-OCR resume path, you need a real browser with a real Canvas and a
real PaddleOCR model run:

1. Open `Docparse/index.html` directly, drop a **scanned** PDF (not a
   text-layer one — those are already covered by Node), and confirm parsing
   behaves as before your change. This is the two-argument call path; it never
   sees `deferOcr`.
2. Open `PR Assistant App.html`, upload a real email with scanned attachments
   from `Demo Data/`, and confirm the light-pass upload returns in roughly
   seconds (not the multi-minute OCR wait the deferred-OCR flow exists to
   avoid) and that clicking Process runs OCR only for the documents assigned to
   a role slot.
3. If you touched `resumeDeferredOcr` or anything it depends on
   (`finalizeEmailResult`, `seedMarks`, retained blobs), confirm resumed
   results match what an eager `parseFile` call on the same file produces —
   deep-equal on `plainText`/`fields`/`records`/`docs[].fields`. There is a
   Node-level version of this check for text-layer documents; for a scanned one
   it has to be eyeballed in the browser since Node cannot run the OCR model at
   all.

**Real Model-Driven App, manual, Save-path changes only**

Nothing under `_test/` has `parent.Xrm.WebApi`. Any change to the Save loop
(`buildRecordPayload`, the create-record loop, `savedRecordIds` retry logic)
is only actually proven inside the real embedded app: confirm a multi-item ATQ
creates one Dataverse record per item with distinct, correctly-formatted
Record_IDs, that each record's fields genuinely come from its own item (not a
neighboring one), and that retrying after a partial failure skips the records
already saved instead of duplicating them.

## Two traps when driving the browser ladder from a script

**A hidden tab does not render.** If you drive `index.html` from an automation
tab that is not the foreground window, `page.render()` never completes —
observed stuck for over 5 minutes on a single A4 page that renders in under a
second when the window is in front. Chrome pauses `requestAnimationFrame` in a
hidden tab entirely, and pdf.js schedules through it. Symptoms look like a hang
in OCR or in the ink pass, because the status line stops at whatever was set
just before the render.

Two ways out, both verified on this repo:

- bring the window to the foreground and keep it there; the stuck render
  finishes instantly, or
- shim it before parsing, which works with the tab still hidden (~35s for a
  1-page scan instead of never):

      window.requestAnimationFrame = fn => setTimeout(() => fn(performance.now()), 0);
      window.cancelAnimationFrame = id => clearTimeout(id);

  Timers are throttled in a hidden tab but not paused, so the render progresses.
  A silent AudioContext does NOT help, and neither does taking a screenshot.

**`file://` is blocked** by the browser extension. Serve the repo instead
(`python -m http.server 8777 --bind 127.0.0.1`) and open
`http://127.0.0.1:8777/Docparse/index.html`. Note that the engine is then cached
like any other script: after editing `docparse-engine.js`, a plain reload can
keep running the old copy. Force it:

    await fetch('/Docparse/docparse-engine.js', { cache: 'reload' }); location.reload();

Check you got what you meant to test before believing a result — an unexplained
"my change did nothing" is usually this.

## OCR reads a short strip far better than a tall one

Relevant to any crop-and-recognize work (`readChopText`, `readSignOffBand`).
Measured on the same scanned page at the same render scale, recognizing the same
four lines:

| strip height (of page) | render | result |
| --- | --- | --- |
| 0.13 | 2200 long edge | `Hong Kong Telecommunications (HKT) Limited` |
| 0.20 | 2200 long edge | `Hong Kong Telecommunications (HKT) Limited` |
| 0.35 | 2200 long edge | `Hong Kon Telecomunictin HT Li e Y` |
| 0.35 | 4400 long edge | `Hong Kong Telecommunications (HKT) Limited` |

Doubling the resolution recovers a tall strip at four times the pixels; keeping
the strip short is the cheaper half of the same trade, which is what
`BAND_MAX_HEIGHT` does.

Separately: the full-page OCR pass on that document returns **nothing at all**
for the band the sign-off block sits in — every line above and below it comes
back, and the four lines naming the two parties do not. The ink lying across
that band appears to cost the detector the whole strip. That is why
`attachContextFromBand` exists; it is not redundant with the page-wide read.

## Rule of thumb

If your change is inside `processPdf`'s OCR branch, `processImage`,
`inspectPagesForMarks`, or anything that only executes when a *scanned* page or
signature ink is involved — the Node harness will pass whether or not you broke
it. Treat a green `ab-diff` as necessary, never sufficient, for those changes;
step 1–3 above are what actually cover them.
