---
target: PR Assistant App.html
total_score: 26
max_score: 40
na_heuristics: 
p0_count: 1
p1_count: 2
timestamp: 2026-08-31T06-56-39Z
slug: pr-assistant-app-html
---
Method: dual-agent (A: critique-a-design-review2 · B: critique-b-detector2)

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Otherwise strong (upload progress, OCR-pending state, "Checking..." on Save), but the always-on Chop Reminder banner actively misreports status on every case (see P0 below) |
| 2 | Match System / Real World | 4 | Vocabulary is the reviewer's own (Continue to save, Agreement Chop & Signed, AVP/SVP approval language); labels sourced from the documents' own dialects |
| 3 | User Control and Freedom | 2 | No modal in the app (DocumentViewer, chop-zoom, Coming Soon) closes on Escape — only exit is mouse-driven close/backdrop click |
| 4 | Consistency and Standards | 2 | Two "primary action" oranges coexist (`PrimaryButton` #FF9900 vs. RoleAssignmentEditor's hand-rolled #D4916E); the one destructive action (record wipe) uses a bare `window.confirm()` breaking from the app's own styled-panel idiom |
| 5 | Error Prevention | 3 | BTB gate hard-blocks Save behind 3 checkboxes when Back-to-Back=Y; LIS existing-record check prevents duplicate creates. Weak spot: destructive record-wipe rides on a native confirm |
| 6 | Recognition Rather Than Recall | 3 | Role Slot Bar always shows which file fills which role; Verify Table header buttons open the exact document a column reads from; 5-state legend spelled out on Verify Table |
| 7 | Flexibility and Efficiency | 2 | Sidebar collapses, admin mode has a faster path — but no keyboard shortcuts, no bulk actions, no fast lane for a trained user processing the routine case |
| 8 | Aesthetic and Minimalist Design | 3 | Restrained palette, justified density — but several data-bearing elements run at 9-11px (cross-check capsules, document-source names), straining an all-day reviewer |
| 9 | Error Recovery | 3 | LIS save failure gives a concrete retry instruction; Outlook drag failure gives actionable, specific messaging |
| 10 | Help and Documentation | 1 | No in-app help; the cross-check glyph legend (✓/≈/≠) only appears on Verify Table, not on Extracted Fields where the same glyphs are first shown |
| **Total** | | **26/40** | **Acceptable — significant improvements needed before users are happy, concentrated in control/freedom, consistency, and documentation** |

## Design Specificity Verdict

**LLM assessment**: Grounded, not category-interchangeable. The comparison model is genuinely document-vs-document (capsules with ≈/≠ keyed to source documents, not a generic diff widget), copy is workflow-literal ("Classic Outlook: drag a mail straight in. New Outlook: save it as .eml first.", "A document marked 未讀 has not been OCR'd yet"), the Company Chop row is a bespoke evidentiary widget with per-mark crops and an honest "Owner not identified" state, and two typefaces carry a deliberate structure-vs-explanation meaning throughout. This could not be re-skinned onto an unrelated CRUD app without losing real functionality.

**Deterministic scan**: `detect.mjs` ran clean (exit 2, 15 findings, 3 rule types) — `side-tab` (10 instances, `border-l-4`), `overused-font` (1, Space Grotesk from Google Fonts), `layout-transition` (3, `.progress-fill`/`.workflow-rail`/`.app-main`), `codex-grid-background` (1, `.verify-stage`). On inspection, most are **false positives given this app's own context**: 9 of the 10 side-tab hits are functionally-justified status/alert banners (error/success/save-state banners with color-coded left borders), not decorative card accents — only the "LINKED RECORD" card border (line 8722) is a genuine unjustified instance. The font and grid-background findings are low-priority advisories for an internal, no-brand-guideline tool. The layout-transition findings are a **documented, deliberate fix**: the surrounding code comment explains these properties were added on purpose to repair a broken sidebar-collapse animation, and it's a one-time toggle, not a frequent-relayout animation — not accidental jank.

**Visual overlays**: Browser inspection succeeded (Chrome MCP tools available, app served via a plain static server since the skill's own `live-server.mjs` is scoped to Live-variant mode, not general static serving). The app rendered correctly standalone with no blank page or hard JS error — a real robustness signal. Script injection was verified as genuinely mutable (not just read-only eval) before the detector script ran. The injected in-page detector found 6 DOM-level issues, most notably **two measured, real WCAG AA contrast failures the static scan could never catch**: the "HKT · IPA PILLAR 1" sidebar section label at **1.9:1** (needs 4.5:1) and the "V2.2.2" version footer at **2.9:1** — both `text-on-#f4f0e8-cream` combinations. One flagged element (a `bookmark-sidebar-...` custom element) was a third-party browser extension injected into the live DOM, not app code — discarded as a false positive. Both the browser tab and the temporary live-server B started were confirmed closed/stopped before reporting; a pre-existing `http-server` on port 8877 that B did not start was correctly left untouched.

## Overall Impression

This is a genuinely well-thought-through, product-specific interface — the evidence-traceability principle (show the source, not just the answer) is executed consistently across at least four different surfaces, not just claimed once. The gap between "good bones" and "good interface" is concentrated in three places: a standing false compliance claim that undermines the app's own core promise of honest uncertainty, a total absence of keyboard escape routes, and a contrast discipline that clearly got real ARIA/labeling attention in the navigation chrome but wasn't carried into the data-dense comparison surfaces where an accountable reviewer spends all day.

## What's Working

1. **The Company Chop row treats absence as a real answer, not a blank.** "Owner not identified" vs. an actual value vs. "No chop found" are three distinct, honestly-labeled states, each with a `title` explaining *why* — principle #2 ("admit ignorance rather than round into a clean result") actually implemented in the UI, not just in the data model.
2. **Every value stays one click from its source.** `DocOpenButton` on the Verify Table, "View →" beside each chop mark, `FieldComparePanel`'s per-role "Says" row — the traceability principle shows up everywhere, not just in a hero feature.
3. **The Role Slot Bar makes an invisible data-binding decision visible and editable.** Which file is "the Agreement" for cross-check purposes is normally opaque; here it's a labeled, colored, clickable bar with a fast correction path when automated classification is wrong.

## Priority Issues

**[P0] The "Chop Reminder" banner is always shown, whether or not a chop mismatch was actually detected.**
- **Why it matters**: the code's own comment admits it — "Static reminder, always shown beneath the table — not conditional on a detected mismatch." It states as fact, on every case, "this case requires further manual review as the company chop does not match the company name on the signed contract." This is a false standing compliance claim in a tool whose entire premise is "admit ignorance rather than round into a clean result" — this banner does the opposite for every single upload. It will either send reviewers escalating cases that don't need it, or train them to ignore a banner that occasionally is telling the truth.
- **Fix**: gate it on the actual chop/company-name comparison result the engine already computes (`markIsOurs`/company-name matching), the same way the period-mismatch reminder right above it is correctly gated on `periodMismatch`.
- **Suggested command**: `/impeccable harden`

**[P1] No modal in the app closes on Escape.**
- **Why it matters**: `DocumentViewer`, the chop-zoom modal, and the "Coming Soon" modal all lack any keydown handler (confirmed by grep — the only global keydown listener in the file is the admin-mode activator). `DocumentViewer` in particular may stay open for minutes while a reviewer cross-references values; a keyboard user, or simply habit, has no way out except finding the mouse and the close button.
- **Fix**: one shared keydown-listener pattern added to all three modal components — trivial to centralize since they already share the same `modal-backdrop`/`role="dialog"` idiom.
- **Suggested command**: `/impeccable audit`

**[P1] Contrast discipline breaks down in the sidebar chrome, in three separate places.** 
- **Why it matters**: the LLM review flagged the ADMIN MODE badge (`#FDE68A` on a 15%-opacity amber wash, estimated well under 2:1) as the one badge whose entire job is keeping a reviewer aware they're in bypass-behavior mode — unreadable, it fails at that job. Independently, the live browser detector *measured* two more real failures: the "HKT · IPA PILLAR 1" sidebar label at **1.9:1** and the "V2.2.2" version footer at **2.9:1**, both against WCAG AA's 4.5:1 minimum. Three separate contrast failures in the same chrome region — this reads less like an isolated slip and more like a pattern of not checking sidebar text-on-tint pairings at all, in an app whose navigation ARIA work elsewhere shows real accessibility effort.
- **Fix**: audit every text-on-tinted-background pairing in the sidebar against the app's own existing pill system (e.g. the `bg-[#FEF3C7] text-[#B45309]` pattern already used correctly elsewhere) rather than one-off colors.
- **Suggested command**: `/impeccable audit`

**[P2] Inconsistent primary-action color, and a native `confirm()` for the one destructive action.**
- **Why it matters**: `RoleAssignmentEditor`'s "Save & re-detect" button uses `#D4916E` instead of the shared `PrimaryButton`'s `#FF9900` — two different oranges trained as "the action to take" dilutes a vocabulary the rest of the app is careful about. Separately, the whole-record-wipe confirmation is a bare `window.confirm()`, which is jarringly lower-friction than the app's own high-ceremony BTB gate for a comparatively lower-stakes decision.
- **Fix**: route the role-editor Save through the shared `PrimaryButton`; replace the native confirm with a styled panel matching the BTB gate's visual weight.
- **Suggested command**: `/impeccable layout` (component consistency), then `/impeccable harden` (destructive-action UI)

**[P2] The cross-check glyph legend (✓/≈/≠) only appears on the Verify Table page, not where the glyphs are first shown.**
- **Why it matters**: `FieldCrossCheck` capsules with these glyphs appear first on the Extracted Fields page, which the nav flow reaches *before* Verify Table. A first-time reviewer meets undocumented glyphs with only a hover-only tooltip before ever reaching the page that spells them out.
- **Fix**: hoist a compact version of the same legend onto the Extracted Fields page.
- **Suggested command**: `/impeccable clarify`

## Persona Red Flags

**Alex (power user, processes many of these a day)**: No fast lane for the routine case — every record, clean or edge-case, walks the same number of clicks through Upload → Process → role-assignment → Extracted Fields → Verify → LIS. Worse, `RoleAssignmentEditor`'s own accepted tradeoff (documented in the codebase) — saving pins *every* role even when the reviewer only meant to fix one — silently opts every future upload out of auto-reassignment the moment Alex touches the editor once. That's exactly the kind of behavior a repeat power user won't expect and won't discover until a later case behaves strangely.

**Sam (accessibility-dependent, screen reader + keyboard-only + WCAG AA)**: Fails on multiple, now partly *measured* fronts — no Escape-to-close on any modal (a keyboard trap in practice), the ADMIN MODE badge's contrast failure, and now two independently-measured failures (sidebar label 1.9:1, version footer 2.9:1), plus pervasive 9-11px text carrying real semantic content. To Sam's credit, the app is not hostile by default — real `aria-label`/`aria-current`/`aria-disabled`/`sr-only` effort exists in the Sidebar and on `ReceivedCheckbox`. This is a codebase that clearly tried on accessibility in the navigation chrome and didn't carry the same discipline into the data-dense comparison surfaces where it matters just as much.

**Riley (stress tester — edge cases, refresh mid-flow)**: BTB confirmation state and the LIS-write dedup guard are plain `useState`, not persisted — a refresh mid-Verify-Table loses "I already confirmed BTB." The LIS side has a real backstop (a live Dataverse re-check before write), so this isn't a data-integrity risk, just a mild annoyance forcing the compliance checklist again after a refresh.

## Minor Observations

- One genuine `side-tab` finding survives scrutiny: the "LINKED RECORD" card's `border-l-[#D4916E]` carries no status semantics, unlike the other 9 flagged instances (which are legitimate colored status/alert banners).
- `activeTab`/`setActiveTab` machinery is vestigial — no UI in the current render calls it except record-reset; a four-tab-per-attachment-type model from an earlier design has collapsed into a single drop-the-whole-email input, but the tab-scoped plumbing is still threaded through the page.
- An entire debug/dev aside ("RAW EXTRACTED TEXT" etc.) is permanently rendered with a bare `hidden` class and no way to ever un-hide it — dead UI still computed every render.
- The old "Automatic Checks" `VerifyPage` (~330 lines, `AUTO_CHECK_GROUPS`/`MANUAL_CHECK_LABELS`) is orphaned since Verify Table was pointed at the real page — no reachable entry point remains.
- The Records page's filter chips ("This week"/"This month"/"My records"/"Needs review") are styled as clickable filters but perform no actual filtering — low risk since Records/Reply are explicitly mocked today, but worth fixing before this ships as real.
- Mixed-language leakage without a bilingual system: bare "未讀" and "接龍" appear inside otherwise English-only copy — reads as intentional domain shorthand today, but will need resolving whichever way the eventual bilingual requirement goes.
- The `codex-grid-background` finding on `.verify-stage` is a borderline call, not a clear false positive — arguably fits the detector's own stated exception for "measurement surfaces" if a verification/audit screen counts as one.

## Questions to Consider

1. If the Chop Reminder banner is meant to always prompt a manual check (per its own comment, "part of the reviewer's own manual-review process"), why does the engine already compute a chop/name match that the banner simply doesn't consult — is its unconditional nature a deliberate "never let automation own this call," or a shortcut that was never revisited once real detection landed?
2. The BTB gate's checklist opens on Back-to-Back = Y, but its first item reads "Confirm this case as NON-BTB" — is the checklist actually asking the reviewer to override the workbook's own flag? If so, should the panel say that explicitly rather than leaving the relationship between the gate's trigger and its first question implicit?
3. Given how much design energy went into "never let a human forget which document a value came from," what would it take to apply the same discipline to *actions* — a lightweight, on-brand confirmation for the record-wipe, matching the BTB gate's visual weight, instead of the one native `confirm()` in the whole file?
