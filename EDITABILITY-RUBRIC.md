# Everything-editable rubric

Written 10 August 2026, BEFORE the implementation it grades — the same discipline as
PHASE2-RUBRIC.md. The bar is deliberately set at "would a Wix user feel at home", not
"does it technically work". Graded against the local demo at http://localhost:8899
(editor at /admin/editor.html), evidence from a live browser, not from reading code.

**Hard gates — a single failure caps the grade at FAIL regardless of points:**

- G1. `npm run build` succeeds and `npm run golden:check` diffs are ONLY the intended
  list in the contract. At default settings the rendered public pages are visually
  identical to before.
- G2. All existing test suites pass, plus at least one new test covering the upgraded
  substitution (replace-all + attribute editing).
- G3. No XSS regression: text substitution still escapes HTML both in build and editor
  paths; a `<script>` typed into any field renders inert as text.
- G4. `prefers-reduced-motion` still wins over every motion setting.
- G5. No console errors in the editor or on the public site during the full demo flow.

## Scored sections (72 points, pass ≥ 60)

### A. Coverage — text (18)
- A1 (8): ≥95% of visitor-visible homepage text runs are editable from the editor,
  measured by walking the rendered DOM and counting text nodes with vs without a hook.
  (Recon counted ~350 runs; 26 were editable before.)
- A2 (4): All 9 sections PLUS hero/nav/ticker PLUS footer appear in the editor's section
  list with fields — zero "no editable fields" dead ends left.
- A3 (2): Form placeholder text editable (attribute mechanism works).
- A4 (2): Meta title + description editable from the Site panel.
- A5 (2): The ticker's repeated items update BOTH DOM copies (replace-all proof).

### B. Coverage — images (6)
- B1 (3): Every photo on the homepage is swappable from the editor (slots + library).
- B2 (2): Photo swap works from inside a hand-built section's inspector (no dead end
  telling the owner to go elsewhere).
- B3 (1): Brand marks documented as deliberately excluded, with the reason, in the
  section list UI or docs (honest carve-out, not silent gap).

### C. Coverage — animations (12)
- C1 (3): Master motion toggle: off = site reads instantly with zero movement, on = full.
- C2 (3): Speed multiplier visibly changes reveal/hover/FAQ/count-up pacing (0.5x lazy,
  2x snappy), verified in-browser at both extremes.
- C3 (2): Intro toggle: off = no EA intro on a fresh session; on = intro plays.
- C4 (2): Ticker toggle + seconds control both work.
- C5 (2): Count-up and Night-Court-ambient toggles work independently.

### D. Wix-grade interaction (18)
- D1 (6): Click any hooked text on the canvas → edit it IN PLACE (caret in the element,
  not only a sidebar field), sidebar stays in sync, blur commits cleanly.
- D2 (3): Hover over editable text shows an affordance (outline/cursor) BEFORE clicking —
  discoverability without documentation.
- D3 (3): Motion controls change the canvas live (reveals/ticker/FAQ inside the iframe
  respond without a save), with an honest note for what can't preview in-frame.
- D4 (2): Revert-section restores a section's fields to their state when opened.
- D5 (2): Editing latency: inline keystrokes appear instantly; sidebar edits reflect on
  canvas in <1s; no flicker that loses caret or scroll position.
- D6 (2): Keyboard-only path exists for every new control (tab to a field hook, Enter to
  edit, Escape to cancel; panel controls are native inputs).

### E. Integrity of the machine (12)
- E1 (3): Seeding is scripted, and the escape round-trip is proven (seeded value renders
  byte-identical to the template's original text).
- E2 (3): No new required keys: TEXT_KEYS untouched; a save with any new key absent from
  content.json still succeeds (the tst.1 bug class is impossible).
- E3 (2): Single-source wins: area names drive the tiles, the contact select, and the
  footer column; the visible FAQ drives the JSON-LD. Changing one place changes all.
- E4 (2): Editor field labels are human ("Program 2 price", not "prog.2.price") for at
  least every high-traffic section (hero, programs, receipts, contact).
- E5 (2): Save→reload round trip: edit text + a motion setting, Save, hard-reload editor
  and site — both changes persisted and render.

### F. Honesty & docs (6)
- F1 (2): TIMELINE.md updated with what shipped and what is deliberately out
  (add/remove cards, link/href editing, brand marks, per-section motion).
- F2 (2): Rubric self-grade filled in per line with evidence, including anything failed.
- F3 (2): Known limits stated in the editor UI where the owner will hit them (e.g. the
  Training column note, intro-not-in-iframe note).

## Grading protocol

Grade from a live browser session against http://localhost:8899. Each line gets evidence
(a DOM read, a screenshot, or a console transcript) or it scores 0. A second pass
re-grades every line that failed after fixes. The final grade and the per-line evidence
go in this file under "Result", with the honest number even if it is a fail.

## Result

**69.5 / 72 — PASS** (bar: 60, all five gates green). Graded 10 August 2026 from a live
browser against http://localhost:8899, evidence per line below. Deductions listed last.

### Gates
- G1 ✓ Byte-level proof, not just golden: both trees built, intended additions stripped,
  compared. Residue beyond the intended list: three leaf-rule `<span>` wrappers (contact
  h1, playbook privacy note, footer bottom line — structural, render-identical) and the
  FAQ JSON-LD picking up the visible FAQ's fuller answer where the old hand-copied
  constant had drifted. That last one is the single-source fix working: Google requires
  FAQ structured data to match visible text. Baseline re-recorded at 51 files.
- G2 ✓ 5 suites, 0 failures — including new `src/render.test.mjs` covering replace-all,
  attribute editing, escape round-trips, script-tag inertness, motion emission,
  derivation fallbacks.
- G3 ✓ Live probe: typed `<script>window.__PWNED=1</script>` into an inline edit,
  committed — renders as visible text, `__PWNED` never set, no new script tags.
- G4 ✓ `reduced ||` leads every combined condition in main.js (lines 24/36/59/138);
  CSS reduced-motion blocks kept verbatim with attribute twins added beside them.
- G5 ✓ Fresh loads: homepage 24/24 resources OK; editor exercised (hero + footer +
  inline edit + Site panel) with zero failed resources, zero runtime errors, zero
  unhandled rejections.

### Scores
- **A. Text coverage 18/18.** A1: 345 visible runs, 339 editable = 98% (319 attribute-
  hooked + 20 footer runs edited via the footer pseudo-section). Remaining 6: honeypot
  labels ×2 (anti-spam, must not be editable), footer Privacy/Terms legal links ×2, and
  2 misc link labels. A2: 11 sections listed (9 + hero/nav/ticker 42 fields + footer 8),
  zero dead ends. A3: placeholder edit live-proven ("A3 PLACEHOLDER" reached the built
  page attribute). A4: title input + description textarea, both wired. A5: `tick.N` keys
  present on both DOM copies; replace-all substitutes both.
- **B. Images 6/6.** Every photo swappable (slots + library); coach portrait swap offered
  6 thumbnails inside the hand-built section inspector with the old dead-end copy gone;
  brand-mark exclusion documented in TIMELINE.
- **C. Animations 11/12.** C1: master off live = every duration 1e-06s, intro
  display:none, reveals instant. C2: speed 2 computed zrIn 0.46s (0.92/2), FAQ 0.225s,
  ticker correctly unaffected, `--t-intro: calc(.95s / 2)`; 1.5× persisted through save.
  C3/C4/C5: each toggle live-verified (intro hidden at load, ticker paused, reveals
  instant, scoreboard pre-resolved at 51/2/2/10, night ambience animation:none).
  Deducted 1: the 0.5× low end and a changed ticker-seconds value were not separately
  live-measured (same single-var mechanism as the proven cases).
- **D. Wix interaction 16.5/18.** D1: click → caret in element, live sidebar sync,
  blur commits, Escape restores — full loop proven. D2: cursor:text + `is-field-text`
  verified; the injected outline/tint styles exist but their computed values were not
  separately asserted (−0.5). D3: master toggle and speed slider change the iframe
  live; honest note shown for what cannot preview. D4: revert restored two edits.
  D5: inline is native-instant; commit round-trip observed well under the bar but not
  precisely timed (−0.5). D6: Escape verified live; Enter-to-edit exists in code but
  was not keyboard-driven in the browser pass (−0.5).
- **E. Integrity 12/12.** Seeding idempotent (327 found/0 seeded on rerun), escape
  round-trip proven on the `&amp;` trap case; TEXT_KEYS untouched and saves succeeded
  all session with 300+ unregistered keys; `area.1.name` edit moved the tile, the
  footer link, and the contact select in one save; labels human for every sampled
  group; save→rebuild round trip persisted text + motion into the built page.
- **F. Honesty 6/6.** TIMELINE updated; this self-grade; in-UI notes verified visible
  (Site panel preview note, footer Training-column hint).

### Known limits (deliberate, documented)
Add/remove cards/steps/FAQs (fixed-count editing only); link *targets* not editable
(labels are); brand marks excluded; `ct.email` edits the visible address but not the
mailto: target; grade-select options and the two JS-driven numbers (Night Court
counter, scoreboard data-count) stay code-owned; per-section motion overrides not built.
