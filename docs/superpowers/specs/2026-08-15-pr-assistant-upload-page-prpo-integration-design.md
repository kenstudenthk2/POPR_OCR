# PR Assistant Upload Page: PRPO Visual Integration

Date: 2026-08-15

## Goal

Make the first page of `PR Assistant App.html` match `PRPO.html` while preserving the working upload, parsing, review, and navigation behavior.

`PRPO.html` defines the visual result. It is a static Tailwind export, not application logic. `PR Assistant App.html` remains the shipping application and the source of truth for state, data, and event handling.

## Scope

Change only `PR Assistant App.html` during implementation. Restyle its `UploadPage` route. Reuse the existing shared shell wherever it already matches the reference. Scope any required shared-component variation to the upload route through a prop or class so Processing, Extracted Fields, Verify, Master Records, Reply, and Document Viewer remain unchanged.

The implementation must remain:

- a single build-free HTML application;
- compatible with `file://`;
- based on the existing React 18, Babel standalone, and Tailwind CDN setup;
- connected to the existing Docparse engine and local library files.

## Visual Structure

The first page will follow the structure in `PRPO.html`:

1. Keep the 240-pixel dark sidebar with the brand, workflow navigation, current-record summary, progress indicator, and New Record action.
2. Keep the Upload & Parse top bar with the attachment count, Demo control, and Process action.
3. Use a two-column content area: a flexible primary column and a 280-pixel supporting column.
4. Place attachment-type tabs and the upload dropzone at the top of the primary column.
5. Present extracted fields, role controls, item tabs, and the Excel-copy action in one card.
6. Present the supplier and buyer remarks in a separate card below the fields.
7. Keep supporting panels, raw extracted text, re-detection, and the verification warning in the right column.

Use the reference page's sand background, white cards, ink sidebar, terracotta accent, typography, borders, radii, and spacing. Adapt fixed export dimensions into the existing responsive application shell so the page remains usable below the 1440-pixel reference width.

## Behavior and Data Flow

Existing React state supplies every displayed value. Do not copy mock customer, contract, amount, or attachment values from `PRPO.html`.

Preserve these flows:

- attachment tabs select the active document type;
- click, drag, and drop call the existing upload handler;
- parsing status, progress, and errors remain visible;
- Demo toggles the existing demo state;
- extracted fields remain editable and retain comparison/source controls;
- role assignment, item selection, re-detection, and both remark builders keep their handlers;
- document links continue to open Document Viewer;
- Process follows the existing processing route;
- New Record clears the existing record state.

The redesign may rearrange markup and Tailwind classes. It must not replace state, callbacks, parser calls, or route transitions.

## Error and Empty States

Retain the current upload error, parsing progress, empty attachment, missing raw-text, and disabled-action behavior. Fit those states into the PRPO card layout without hiding diagnostic text or making unavailable controls appear active.

## Verification

Implementation is complete when evidence proves that:

1. The Babel JSX source compiles without syntax errors.
2. The initial route renders the PRPO page structure and styling.
3. Attachment tabs, file selection, drag-and-drop, Demo, field editing, role controls, item selection, remark controls, re-detection, viewer links, Process, and New Record still invoke their existing handlers.
4. Later routes render with their previous components.
5. The application loads from its build-free HTML entry and preserves `file://`-safe resource paths.
6. A visual comparison at the 1440-pixel reference width confirms the sidebar, top bar, columns, cards, tabs, dropzone, fields, remarks, and supporting panels match `PRPO.html` closely.

## Risks

- Reordering a large JSX block can disconnect a callback or conditional state.
- The static reference uses fixed widths that can overflow on narrower screens.
- An unscoped shared-component change can alter later routes.
- The reference contains placeholder content that must not enter live state.

Verification will therefore combine static JSX checks, interaction checks, later-route smoke tests, and a rendered visual comparison.
