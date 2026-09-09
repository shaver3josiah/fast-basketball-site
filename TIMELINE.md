# Fast Basketball — project timeline

Repo: `shaver3josiah/fast-basketball-site` · branch `main`
Last updated: **8 September 2026, 15:00**

Dates in "Done" are taken from the git history, not from memory. Dates in "Ahead" are
**effort estimates against a working session**, not calendar commitments — the calendar
depends on how often you sit down with it, which is yours to decide, not mine to assume.

---

## Where it stands, in one line

The site is built and editable; the editor works locally end to end; nothing is hosted
yet, and that is now a choice rather than a blocker.

| | |
|---|---|
| Pages building | 19 |
| Canvas element types | 6 (text, image, shape, icon, divider, button) |
| Hand-built sections editable | 5 of 9 · 23 fields |
| Golden-output baseline | 54 files locked |
| Test suites | 10 |
| Phase 2 rubric score | **141 / 160** — passed the 130 bar |

---

## Done

### 4 Aug — the site itself
**Goal: a real site, not a template.** · 4 commits

Design system applied, copy written in the coach's voice, 22 pages generated from a
hand-rolled Node static site generator. Two rounds of design critique fixed working
forms, the FAQ, accessibility and honest content.

### 5 Aug — making it truthful
**Goal: nothing on the page that cannot be verified.** · 6 commits

Structured data cut back to one real business entity with no invented addresses. The
service area moved from Miami-Dade to North Broward on verified data only, retiring
twelve city pages behind redirects. Real pricing, the real tagline, and privacy and
terms pages with a parent gate on every form that collects a child's data.

### 6 Aug — the canvas engine and the editor
**Goal: free drag-and-drop that cannot break on a phone.** · 7 commits

The compiler, the data model, the local dev server, and the editor itself. Three
guarantees built into the compiler rather than left to editor discipline: geometry
stored as percentages, type clamped so it can never resolve illegible, and any section
narrower than 1000px stacking in reading order automatically.

Also the day the repo turned out to be behind its own build output — roughly 46KB of
shipped source (the light/dark theme, the Night Court game) existed only inside a
preview folder and was one deletion from being lost. Recovered and committed.

### 7 Aug — the audit
**Goal: find what I could not see myself.** · 1 commit

41 findings from an adversarial audit, verified before fixing. Three blockers, including
one where typing in any inspector field silently lost focus mid-word and the next
Backspace deleted the element.

### 8 Aug — safe to host, and Phase 2 opens
**Goal: editing must not be able to take the site offline.** · 6 commits

Netlify bills in credits — 15 per production deploy, 300/month free — and every commit
triggers one. Saving now writes a draft; only Publish spends a deploy. The nine
hand-built sections became editable without converting them. Phase 2's first pass landed
layers, align, duplicate and two new element types, graded 118/160 against a rubric
written before the work.

### 8 Sep — the September price sheet
**Goal: the site sells what Blake actually sells now.** · shipped in the same commit as the Stripe work below

Blake's new sheet replaced the pricing outright. Six month terms take over from twelve,
"Unlimited" replaces the twice-a-week tier, and paying over time now costs more than paying
up front: $450 in full or $550 monthly on three months, $750 or $900 on six. That last part
was a model change, not new numbers. Every pay option used to be derived from one total,
which cannot express a monthly price a hundred dollars higher, so a membership now carries a
`totals` map keyed by pay option and offers exactly the options it prices. Split payment and
per-session pricing are gone because the sheet prices neither. `/terms` still reproduces the
signed agreement verbatim, $840 and all, and says plainly that the document is being
re-issued: rewriting contract text to match new marketing would change what the site claims
families agreed to without changing what anyone signed.

### 8 Sep — Stripe enrollment
**Goal: a parent pays for a plan from the site, and nobody types a price by hand.** · 1 commit, `fe74485`, with the price sheet above

Hosted Stripe Checkout, reached from a new `/enroll` page that renders the plan matrix
from `src/lib/plans.mjs`; no Stripe script on the site, so the CSP and the performance
budget stand. Prices live in Stripe under lookup keys generated from that one catalog by
`scripts/stripe-catalog.mjs`, which is the only way a charge changes. A signed webhook
writes each enrollment to the leads store and emails Blake a prefilled welcome email with
the cancel-by date already computed, and monthly plans get a subscription schedule for the
term they were sold so nobody tracks the count by hand. The admin panel gained
a per-family enrollment link builder and enrollments in the CSV export. Built against the
default of every decision in `STRIPE-PLAN.md`; nothing has called Stripe yet.

---

## Ahead

### Phase 2 — passed, 8 Aug
**Goal was: score 130+ on the rubric. Result: 141/160 over two grading loops.**

Loop 1 scored 118 and caught a bug in my own work — the dev server had been serving a
stale compiler, so an earlier grade would have measured code that was not running.
Loop 2 scored 141 with every loop-1 fix verified and no regressions, and the row 18
veto held against a hostile 15-element section measured at ten widths from 1000px down
to 280px.

### 8 Aug — the media library
**Goal: the owner can put a photo on the site without asking anyone.** · uncommitted

The largest named Phase 2 gap, closed. Photos upload from the editor, get cropped and
downscaled in the browser before they leave it, and land in a Photos panel that any image
element or hand-built slot can pick from. The dead end that told the owner to "swap the
photo itself in the content admin" is gone.

It cost almost nothing structurally, because the compiler was already built the right way:
a library photo is an ordinary key in `content.json`, so `responsive-images.mjs` generates
its variants and `render.mjs` renders it with **no change to the build at all**. Verified
end to end — an uploaded photo came back out of the canvas as a generated `-640.webp`.

What did need building was the cost control. Every GitHub commit triggers a deploy, and
uploading a dozen photos the old way would have fired roughly 36 build triggers — 540
credits against a 300/month budget, which is the site going offline. Uploads now stage in
Blobs for free and Publish commits them in **one** commit via the Git Data API, so twelve
photos cost one deploy instead of twelve.

Still open, and deliberately so:

- **Group / ungroup and multi-select.** Distribute currently acts on every unlocked
  element in the section because there is nothing else to act on.
- **A brand-kit editor.** The mechanism is proven — the compiled CSS is 100% `var()`
  with zero raw hex, and changing a token moves every consumer — but the only way to
  change a token today is to edit `tokens.css` by hand.

### 10 Aug — everything editable
**Goal: every text blob, picture, and animation editable, at Wix-grade interaction.**
Rubric written first, graded after: **69.5/72, all five hard gates green** (EDITABILITY-RUBRIC.md).

Coverage went from 26 editable text runs (7%) to 339 of 345 (98%): 327 hooks across
every template, the footer and hero/nav/ticker as first-class editor sections, form
placeholders via a new attribute-editing mechanism, meta title/description in a Site
panel. Click any text on the canvas and type in place — caret in the element, sidebar
in sync, Escape restores, Revert Section undoes a whole section. Photos were already
covered by the media library; the coach portrait and every other slot now swap from
inside their sections too.

Animations got an owner-facing motion panel: master kill switch, speed multiplier
(measured: 2× halves every reveal/FAQ/intro duration, computed live), and independent
toggles for intro, ticker, reveals, count-up, and Night Court ambience — all persisted
in content.json, all previewing live inside the editor canvas, and none of it able to
override a visitor's reduced-motion preference.

The mechanism stayed lazy: library photos and editable text are ordinary content.json
keys; ~300 of them were seeded by script from the templates' own text (idempotent,
escape-round-trip proven), so the built site is byte-identical at defaults — proven by
building both trees and comparing after stripping only the hook attributes and the two
emitted motion tags. One drift bug surfaced and died on the way: the FAQ structured
data was a hand-copy of the visible FAQ and had already diverged; it now derives from
the same keys, as do the area names (tile + contact select + footer column from one
edit) and the footer text.

Deliberately not built: adding/removing cards (fixed-count editing only), link targets,
brand-mark swapping, per-section motion overrides. Each is named in the rubric's known
limits with its reason.

### Next — Phase 3, safe to hand over
**Goal: the owner can use it unsupervised without breaking anything.**
Estimate: **3–4 sessions**

- Per-breakpoint editing: override the auto-derived tablet and phone layouts by hand.
- Guardrail UI: contrast warnings in the colour picker, overflow flagged on canvas,
  heading order, tap-target size, image weight.
- Version history and one-click revert — free, since they are git commits.
- Page management: create, duplicate, delete, slug, per-page SEO, nav and footer.
- Leads: per-lead status. (CSV export shipped 8 Sep with the enrollment rows.)

### Go live — code side done, 8 Aug
**Goal: the site is public and the owner is editing it.**

`main` was 18 commits behind and would have deployed the 5 August site with no editor and
no media library at all. It has been fast-forwarded to the current work and pushed, builds
clean, and matches the golden baseline. The site will launch **indexable** —
`ROBOTS_ALLOW = "true"` in the production context, a deliberate choice.

The checklist is `LAUNCH.md`, which supersedes `phase-c/P10-netlify-deployment-guide.md`
wherever they disagree. P10 was audited at 92.5/100 against the 4 August site and five
parts of it are now wrong — most importantly its whole Netlify Identity section, which
describes an auth model this site does not use, and its variable table, which omits the
four variables everything now depends on.

**Blocked on you, not on code**, and not delegable: creating the Netlify site, entering the
environment variables (they are secrets), pointing DNS at Wix, and the Stripe
live cutover (keys, catalog script, webhook). `LAUNCH.md` has the exact steps and the
five-minute verification pass that proves it worked.

The domain question is closed: Blake bought `fast-basketball.com` from Wix, and `171dbd3`
made it the fallback in `src/lib/site-config.mjs`. Ignore `phase-c/P11`'s
`fastbasketballmiami.com` recommendation, written the day before the business moved to north
Broward. DNS is at Wix, which the domain runbook does not cover.

---

## Open items that need the owner

Tracked privately in `docs/owner-open-items.md` at the project root, outside this public
repository, because they name people and describe an unsigned commercial position.

Two items that appeared here through August are now closed: the phone number is published,
and `/terms` reproduces the signed training agreement instead of saying cancellations are
handled case by case.

---

## Known limits, stated plainly

- ~~4 of 9 hand-built sections cannot be edited yet~~ Closed by the 10 Aug editability
  work: every section template carries hooks now. What is deliberately not editable is the
  dollar figures on the programs card, which mirror the Stripe catalog in `plans.mjs`.
- **The canvas is a desktop surface.** Below 1000px it stacks automatically. Hand-laying
  a phone breakpoint is Phase 3.
- **The editor is desktop-only** and says so below 900px.
- **The deploy meter is a floor, not a truth.** It counts publishes made through the
  editor and cannot see deploys triggered by a git push or from Netlify's UI.
- ~~The publish split does not cover hand-built sections yet~~ Closed. `admin-content.mjs`
  writes a draft on every save, `admin-publish.mjs` merges the content draft with the
  canvas draft into one commit, and the Content Admin at `/admin/` has its own Save and
  Publish buttons. Editing the hero costs nothing until Publish.
- **Adding a resume card still commits directly.** The `resumeExtra` path in
  `admin-upload.mjs` writes to an array rather than to `content.images`, which the staging
  model has no way to represent, so it was left alone. Rare enough to be worth its cost.
- **`/lab` is a proving ground**, not part of the site. It is `draft: true`, noindex and
  absent from the sitemap.
