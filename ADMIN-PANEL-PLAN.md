# Fast Basketball Admin Panel — Three-Phase Plan

Free drag-and-drop canvas editor with a Canva-grade asset toolbox, git-backed,
running fully on localhost before anything goes online.

Repo: `shaver3josiah/fast-basketball-site` (this directory). Branch: `admin-canvas`.

---

## Where we start

The site today is a hand-rolled Node static site generator. `build.mjs` reads
`src/data/content.json` and string-replaces values into hand-written HTML partials
in `src/templates/sections/`. The existing admin panel edits **35 fields total** —
29 text keys and 6 images, hardcoded in `src/lib/content-schema.mjs`.

Everything else — every heading, the four program cards and their prices, the FAQ,
the Locker resource list, nav, footer, colors, fonts, and the page structure itself —
is baked into `build.mjs` and the section templates. No admin panel edits reach it.

That is the gap. Closing it means moving structure out of code and into data.

## What we are building

**Free canvas inside stacked sections.** A page is a vertical stack of sections.
Inside any section you drag, resize, rotate and layer elements anywhere you want,
Canva-style. This is the model Wix Studio and Figma Sites use, and it is the reason
their output survives a phone while classic Wix output does not.

**The canvas compiles to static CSS.** No editor runtime ships to visitors. The
public site stays exactly what it is now: static HTML, self-hosted fonts, vanilla JS,
no framework. All the weight lives behind the admin login.

### Three rules that keep a free canvas from producing a fragile site

These are engineering decisions, not restrictions on what you can drag.

1. **Positions are stored relative, never in raw pixels.** An element's box is a
   percentage of its section, emitted with container-query units. Resize the browser
   and the composition scales instead of falling apart.
2. **Every section auto-derives its mobile layout from day one.** The compiler
   reflows canvas children into reading order and stacks them at narrow widths
   automatically. You override it by hand when you want to; you never inherit a
   broken phone layout by forgetting to.
3. **The build refuses to compile a broken page.** Overflow, unreadable contrast and
   missing alt text fail the build rather than shipping. A guard that fires after
   publish is not a guard.

Rules 2 and 3 sit in Phase 1 on purpose. They are the difference between a canvas
editor and a canvas footgun, and retrofitting either one later is a rescue project.

### Rule 4, added after research: saving is not publishing

Netlify no longer bills in build minutes. It bills in credits, **15 per successful
production deploy**, and the free tier is **300 credits** — twenty deploys. Netlify's
own wording for what happens after that:

> "all of your web projects (sites/apps) are paused and visitors to your web projects
> will find a `Site not available` page"

([Netlify: how credits work](https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/how-credits-work/),
[pricing](https://www.netlify.com/pricing/))

Today, every admin save commits to GitHub, and every commit triggers a production
deploy. **The site as it stands goes dark on the owner's twentieth edit of the month.**
That is true right now, before any of this is built.

So the editor splits the two, in Phase 1:

- **Save** — continuous, instant, unlimited, costs nothing. Drafts go to Netlify Blobs
  in production and to a local file in development.
- **Publish** — deliberate, explicit, commits to GitHub and spends one deploy. The
  button shows how many deploys are left this month.

Deploy previews, branch deploys, failed deploys and rollbacks all cost zero credits,
so preview-before-publish is free and version rollback is free.

---

## Phase 1 — Canvas engine, compiler, and a working local demo

**Goal: `npm run dev` gives you the site and the admin panel running together on
localhost, with no cloud credentials, and you can drag something and see it change.**

| # | Deliverable | Why it is here |
|---|---|---|
| 1 | **Golden-output test** (`scripts/golden.mjs`) | Snapshots today's `dist/` HTML. The migration must not silently regress four rounds of design work. Written *before* any migration, not after. |
| 2 | **Data model** — `src/data/site.json`, `src/data/theme.json` | Pages → sections → elements. Element = `{id, type, props, box, z, locked, hidden}`, box in relative units per breakpoint. Theme = the brand kit. |
| 3 | **The compiler** — `src/lib/compile.mjs` | site.json → static HTML + generated CSS. Container-query positioning, auto mobile reflow, per-breakpoint overrides. The heart of the system. |
| 4 | **Storage adapter** — `netlify/functions/lib/store.mjs` | One `get`/`put` interface. GitHub Contents API in production, local filesystem in dev. Same function handlers run in both. |
| 5 | **Local dev server** — `scripts/dev-server.mjs` | Zero dependencies. Serves `dist/`, routes `/.netlify/functions/*` to the real handlers, rebuilds on save, live-reloads the preview. |
| 6 | **Canvas editor v1** | Select, drag, resize, rotate, multi-select marquee, snapping with smart guides, z-order, group, lock, undo/redo, keyboard shortcuts, breakpoint switcher. Elements: text, image, shape, button. |
| 7 | **Migration of the nine existing sections** | Imported as locked legacy sections that render byte-identically today, unlockable into canvas sections one at a time. Patient conversion, not a proud rewrite. |
| 8 | **Save/publish split** (see Rule 4) | Drafts to Netlify Blobs in production, a local file in dev. Only an explicit Publish commits and spends a deploy. Not optional — without it the site is capped at twenty edits a month. |

**Dependencies added:** `moveable` and `selecto` (MIT, vanilla, self-hosted into
`admin/vendor/` so the existing `script-src 'self'` CSP holds). These solve transform
handles, snapping and group selection — the part that is genuinely hard to hand-roll
well. Everything else is written here.

**Reused, not rebuilt:** `scripts/responsive-images.mjs` (sharp) for image variants,
`scripts/fetch-fonts.mjs` for self-hosting new fonts, the existing signed-cookie auth,
and the existing Netlify functions.

**Gate:** you open localhost, log in, drag a headline, resize a photo, hit save, and
watch the live site change. If that does not work end to end, Phase 1 is not done.

---

## Phase 2 — The Canva-grade asset toolbox

**Goal: build a brand-new section from scratch without touching code.**

1. **Element palette** — text, image, shape (rect, ellipse, line, arrow, polygon,
   star), icon (one bundled Lucide sprite), button, divider, video, embed, form.
2. **Inspector** — fill (solid, gradient, image), stroke, per-corner radius, opacity,
   shadow, blur, blend mode, rotation, flip.
3. **Text engine** — font picker across the brand fonts plus any Google Font,
   self-hosted at build time through the existing fetch-fonts script. Size, weight,
   line height, tracking, alignment, case, color, links, lists, inline emphasis.
4. **Media library** — upload, organize, tag, crop with focal point, filters,
   replace-everywhere, automatic responsive variants. Alt text required to save.
5. **Brand kit** — logo assets, palette, type scale, button styles. Change once,
   propagates everywhere.
6. **Composition tools** — align and distribute, group and ungroup, lock, duplicate,
   copy-paste across sections, save any section as a reusable template.
7. **Layers panel** — drag to reorder, rename, hide, lock, nested groups.

**Gate:** you build a section that does not exist today — pick anything — using only
the panel.

---

## Phase 3 — Responsive control, publishing safety, pages, go-live

**Goal: safe to hand over, then online.**

1. **Per-breakpoint editing** — desktop, tablet, phone. Override the auto-derived
   mobile layout by hand; hide any element per breakpoint.
2. **Guardrail UI** — the Phase 1 build-time checks get a real interface: contrast
   warnings live in the color picker, overflow flagged on the canvas, heading order,
   tap-target size, image weight budget. Blocking on critical, advisory otherwise.
3. **Publishing safety** — draft versus published, autosave, a visual diff before you
   publish, version history with one-click revert (free — they are git commits),
   session undo.
4. **Page management** — create, duplicate, delete pages. Slug, per-page SEO and OG
   image, nav and footer editing, redirects.
5. **Leads** — the existing list, plus CSV export and per-lead status.
6. **Impeccable pass on the admin panel itself** — product register, full keyboard
   paths, every state (empty, loading, error, conflict), accessibility.
7. **Netlify wiring and go-live runbook** — last, and only after you have signed off
   on the local demo.

**Gate:** an impeccable critique of the admin UI with no P0 or P1, and the go-live
checklist signed.

---

## What the research changed

Two research passes ran against this plan: an inventory of what Wix actually lets a
non-technical owner edit, and a survey of editor architectures (Puck, Editor.js,
TinaCMS, Decap, Sanity, Payload, Builder.io, Plasmic, Keystatic).

**Breakpoints match Wix Studio's defaults** — desktop 1001px and up, tablet 751–1000,
phone 320–750 — because they are what anyone who has used a site builder expects.
Wix caps you at six; there is no reason to cap here.

**Cheap wins Wix does not offer**, straight off the complaint list: sections reorder by
drag rather than by clicking arrows, undo survives a page reload instead of dying with
the browser tab, and there are no artificial ceilings on pages, colors, redirects or
meta tags. Wix caps those at 298, 25, 5,000 and 10 respectively.

**Every editor framework was rejected, and the reason is the same one.**
`netlify/functions/preview.mjs` already imports the real renderer and server-renders a
live page from draft content. That means preview fidelity — the hardest problem in
visual editing — is already solved here, and every candidate tool would *regress* it:
Decap requires rewriting all nine sections in `React.createElement` for its preview,
Puck requires them as React components. Both leave two renderers to keep in sync, and
they drift the first time somebody edits one. Building on the existing renderer keeps
one source of truth and adds no framework to the public site.

**Priority was re-ordered against real usage.** The research ranked what small-business
owners actually touch. Editing text, replacing images, previewing and publishing,
undo/restore, links and buttons, and per-page SEO are all high-frequency. Gradients,
blend modes and multi-breakpoint tuning are not. The Canva toolbox is still Phase 2 as
you asked, but the high-frequency safety items — undo, preview, publish, version
restore — move up to sit beside it rather than waiting for Phase 3.

## Honest notes

**On "more customizable than Wix."** For this site, this build wins on the things
that matter: you own the block types, every design token is editable, publishing is
git-versioned with a real diff and a one-click revert, and the output stays a fast
static site. Wix has a decade and a large engineering org behind features this will
not have — an app market, built-in ecommerce, booking, and a stock media catalogue.
Where those matter, Wix wins, and pretending otherwise would be a lie told to make
the plan sound better.

**On scope.** A free canvas plus a Canva-grade toolbox is roughly three times the
work of a block editor. That was a considered choice, made after the trade-off was
put on the table. The phases are ordered so that Phase 1 alone is independently
useful: even if the work stopped there, the site would be data-driven with a working
local editor.

**On review.** Each phase ends at a gate you run yourself, not a status report you
read. Work that is never reviewed by anyone but its author is fragile work.
