# Fast Basketball — project timeline

Repo: `shaver3josiah/fast-basketball-site` · branch `admin-canvas`
Last updated: **8 August 2026, 12:05**

Dates in "Done" are taken from the git history, not from memory. Dates in "Ahead" are
**effort estimates against a working session**, not calendar commitments — the calendar
depends on how often you sit down with it, which is yours to decide, not mine to assume.

---

## Where it stands, in one line

The site is built and editable; the editor works locally end to end; nothing is hosted
yet, and that is now a choice rather than a blocker.

| | |
|---|---|
| Pages building | 17 |
| Canvas element types | 6 (text, image, shape, icon, divider, button) |
| Hand-built sections editable | 5 of 9 · 23 fields |
| Golden-output baseline | 51 files locked |
| Test suites | 2 |
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

### Next — Phase 3, safe to hand over
**Goal: the owner can use it unsupervised without breaking anything.**
Estimate: **3–4 sessions**

- Per-breakpoint editing: override the auto-derived tablet and phone layouts by hand.
- Guardrail UI: contrast warnings in the colour picker, overflow flagged on canvas,
  heading order, tap-target size, image weight.
- Version history and one-click revert — free, since they are git commits.
- Page management: create, duplicate, delete, slug, per-page SEO, nav and footer.
- Leads: CSV export and per-lead status.

### Then — go live
**Goal: the site is public and the owner is editing it.**
Estimate: **1 session, plus owner steps**

Netlify wiring is now safe because the publish split exists. The runbooks are already
written: `phase-c/P10-netlify-deployment-guide.md`, `P11-domain-dns-runbook.md`,
`P12-gbp-local-seo-launch.md`.

**Blocked on you, not on code:** the domain purchase, and the environment variables
(`ADMIN_PASSWORD`, `ADMIN_SESSION_SECRET`, `GITHUB_TOKEN`, `GITHUB_REPO`, `SITE_URL`).

---

## Open items that need the owner

These have been outstanding since the site was built and no amount of engineering
closes them.

| Item | Why it matters |
|---|---|
| Miami/Broward training photography | Every proof image is a college gym. The design system calls this the launch blocker. |
| Verified reviews | Testimonial placeholders were removed rather than invented. The section returns when real reviews exist. |
| Real phone number | Currently reads "Not published yet". |
| Blake's exact role at RMU and Moberly | A comment in `receipts.html` is waiting on it. |
| Cancellation policy | `/terms` says it is handled case by case, which is true for a new programme but is not a policy. |
| A Florida attorney reading `/privacy` and `/terms` | Both carry a visible note saying so. Written in good faith by someone who is not a lawyer. |
| Oregon club credential | Stays excluded until independently verified. |

---

## Known limits, stated plainly

- **4 of 9 hand-built sections cannot be edited yet** (`method`, `nights`, `resources`,
  `areas`). They carry no edit hooks; adding them is a code change.
- **The canvas is a desktop surface.** Below 1000px it stacks automatically. Hand-laying
  a phone breakpoint is Phase 3.
- **The editor is desktop-only** and says so below 900px.
- **The deploy meter is a floor, not a truth.** It counts publishes made through the
  editor and cannot see deploys triggered by a git push or from Netlify's UI.
- **The publish split does not cover hand-built sections yet.** `admin-content.mjs` commits
  and fires the build hook on every POST, and the editor's Save routes there whenever a
  hand-built section is being edited (`editor.js`, `state.mode === 'legacy'`). So editing
  the hero or the coach bio still spends a deploy per save, exactly as it did before the
  split existed. The canvas and the media library both stage properly; this one surface
  does not. Fixing it means giving `content.json` the draft treatment `site.json` already
  has, and giving the older Content Admin at `/admin/` a Publish button, since it has none
  and currently relies on that immediate commit.
- **Adding a resume card still commits directly.** The `resumeExtra` path in
  `admin-upload.mjs` writes to an array rather than to `content.images`, which the staging
  model has no way to represent, so it was left alone. Rare enough to be worth its cost.
- **`/lab` is a proving ground**, not part of the site. It is `draft: true`, noindex and
  absent from the sitemap.
