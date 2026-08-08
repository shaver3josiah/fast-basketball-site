# Phase 2 rubric — the asset toolbox

The contract this phase is graded against. Written before the work, so the grade is a
measurement rather than an opinion formed afterwards.

Graded 0–4 per row. **0** absent · **1** present but broken · **2** works with real
friction · **3** works · **4** works and is hard to misuse.

A row scoring 3 needs no further work this phase. Rows at 0–1 are the backlog.

## Weighting

Weighted by how often a small-business owner actually reaches for it, from the Wix
usage research: replacing an image, editing text and publishing are daily; gradients and
blend modes are close to never. An unweighted score would let a gradient picker paper
over a missing layers panel.

| Weight | Meaning |
|---|---|
| ×3 | Used in almost every editing session |
| ×2 | Used most sessions |
| ×1 | Occasional, or a power-user reach |

## The rubric

| # | Capability | Weight | What a 4 looks like |
|---|---|---|---|
| 1 | **Add an element** | ×3 | Every registered type is one click from the toolbox, lands somewhere visible, and is immediately selected and editable. |
| 2 | **Duplicate** | ×3 | Ctrl+D and a menu item. The copy is offset so it is visibly a copy, selected, and undoable as one step. |
| 3 | **Delete** | ×3 | From canvas keyboard and from the inspector. One undo restores it exactly. |
| 4 | **Layer order** | ×3 | Raise/lower/front/back, reflected live, and never leaves two elements sharing a z that makes order arbitrary. |
| 5 | **Layers panel** | ×2 | Lists every element top-to-bottom in paint order, shows type and name, selects on click, and follows canvas selection. |
| 6 | **Rename an element** | ×2 | Editable name, used by the layers panel and the element's accessible label. |
| 7 | **Hide / show** | ×2 | Per element, reflected on canvas and in the published page, reversible. |
| 8 | **Lock / unlock** | ×2 | A locked element cannot be dragged, resized or deleted by accident, and says so. |
| 9 | **Align** | ×2 | Left / centre / right / top / middle / bottom against the section. Exact, not eyeballed. |
| 10 | **Distribute** | ×1 | Even horizontal and vertical spacing across 3+ elements. |
| 11 | **Element vocabulary** | ×2 | Beyond text/image/shape/button: at minimum an icon and a divider, each with real fields. |
| 12 | **Shape vocabulary** | ×1 | Rectangle, ellipse and line at minimum, each visibly distinct and correct in the phone stack. |
| 13 | **Appearance depth** | ×1 | Shadow and per-corner radius reachable from the inspector, emitted as real CSS. |
| 14 | **Image handling** | ×3 | Pick from real photos, alt text enforced, focal point, fit, corner radius, and a priority toggle for above-the-fold. |
| 15 | **Type control** | ×3 | Family, size, weight, line-height, tracking, case, alignment and colour — every one of them actually winning against base.css. |
| 16 | **Brand colour** | ×2 | Named brand swatches that write a token, so changing the token moves everything using it. |
| 17 | **Undo depth** | ×3 | Every mutation above is undoable, a run of nudges counts as one, and undo survives without losing selection. |
| 18 | **Nothing can break the phone layout** | ×3 | Whatever the toolbox produces, the compiler still guarantees no overlap, no collapse and no horizontal scroll below 1000px. |

Max weighted score: **4 × 40 = 160**.

## Bar

- **< 100** — not shippable, keep looping.
- **100–129** — usable, with named gaps.
- **130+** — Phase 2 done; anything left is Phase 3 or deliberate.

## Rules for grading

1. Grade by **driving the editor**, not by reading source. A field that exists in the
   registry but does nothing on the canvas scores 1, not 3.
2. Every score cites concrete evidence: what was clicked, what was measured, what the
   computed style or saved JSON says.
3. Row 18 is a veto. If the toolbox can produce a broken phone layout, the phase does
   not pass regardless of total.
4. Prefer the harsher score when torn. An inflated grade wastes the next loop.
