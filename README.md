# Fast Basketball Website

This is the source code for the Fast Basketball website. If you are the site owner and you just want to edit words or photos, you do not need anything in this file. Open `admin/OWNER-GUIDE.md` instead, or go to yoursite.com/admin.

This file is for whoever sets up or maintains the code.

## What this is

A static website. There is no database and no server that runs all the time. A build step turns the files in `src/` into plain HTML, CSS, and JavaScript files in `dist/`, and Netlify serves those files to visitors. A small number of Netlify Functions handle the contact playbook generator and the content admin panel.

## Running it on your own computer

You need Node.js version 20 or newer installed.

1. Open a terminal in this folder.
2. Run `npm install`. This downloads the two small tools the build uses.
3. Run `npm run build`. This creates the `dist/` folder with the full site inside it.
4. Run `npm run dev` to view it in a browser at `http://localhost:8888`.

If you change anything in `src/data/content.json`, `src/data/suburbs.json`, or `src/data/playbook-templates.json`, run `npm run build` again to see the change.

## Checking the suburb data

Run `npm run validate:suburbs` before every deploy. It reads `src/data/suburbs.json` and stops with a clear error if any required field is missing. The build itself also runs this check automatically and will refuse to build a broken suburb page rather than publish a thin or empty one.

## Re-extracting from a new preview file

If the design team hands over a new version of the single-file preview HTML:

1. Run `node scripts/extract-images.mjs --src path/to/new-preview.html --images-dir src/images/source --manifest src/data/image-manifest.json --prepared-html work/prepared.html`
2. Run `node scripts/split-sections.mjs --src work/prepared.html --out src/templates/sections`

Both scripts find their targets by HTML id and data attribute, not by line number, so they keep working even if the preview file is reordered or edited.

## Project layout

```
build.mjs                   the build script, run by npm run build
scripts/                    extraction, splitting, validation, and image tooling
src/data/                   content.json, suburbs.json, playbook-templates.json
src/templates/sections/     the seven homepage sections, extracted from the preview
src/lib/                    shared rendering and content logic
src/styles/                 tokens.css, base.css, fonts.css, site.css
src/images/source/          original extracted photographs, byte for byte
src/fonts/                  self-hosted font files
src/js/                     the small amount of public-facing JavaScript
admin/                      the content admin panel, deployed to /admin
netlify/functions/          serverless functions: playbook, admin auth, uploads, leads
dist/                       build output, not committed to git
```

## Environment variables

Set these in the Netlify dashboard under Site configuration, Environment variables. Never put real values in this repository.

| Variable | Holds |
|---|---|
| `ADMIN_PASSWORD` | The single password that unlocks /admin. |
| `ADMIN_SESSION_SECRET` | A long random string used to sign the admin login cookie. Generate once, never reuse elsewhere. |
| `GITHUB_TOKEN` | A fine-grained GitHub personal access token, write access to this one repository only. Lets the admin panel commit content and photo changes. |
| `GITHUB_REPO` | The repository in `owner/name` form, for example `blakekingsley/fast-basketball`. |
| `GITHUB_BRANCH` | The branch the site deploys from. Defaults to `main` if not set. |
| `NETLIFY_BUILD_HOOK_URL` | Optional. A Netlify build hook URL. If set, the admin panel calls it after every save as a backup trigger, in case GitHub-triggered auto deploys are ever turned off. |
| `RESEND_API_KEY` | API key for the Resend transactional email service, used to email the generated playbook. |
| `PLAYBOOK_FROM_EMAIL` | The from address playbook emails are sent from, for example `playbook@fastbasketballmiami.com`. Must be a verified sender in Resend. |

If `RESEND_API_KEY` or `PLAYBOOK_FROM_EMAIL` are missing, the playbook function still generates and returns the document. It just skips sending the email and reports that in its response, so a visitor's download never depends on email working.

## Deploying

Push to the connected branch. Netlify runs `npm run build`, publishes the `dist/` folder, and deploys the functions in `netlify/functions/`. See `netlify.toml` for headers, redirects, and function configuration.

## Technical decisions

These are the choices made when this site was built and why, kept here so a future maintainer does not have to re-derive them.

### Static site generation: a plain Node build script instead of a framework

The build is a Node script (`build.mjs`) that reads JSON and HTML template files and writes plain HTML to `dist/`, with no framework such as Eleventy or Astro in between. This keeps the dependency list to almost nothing, which matters on Netlify's free tier where build minutes and install time are limited. It also makes the suburb page generator trivial to reason about: it is a for loop over `suburbs.json` calling one render function per record, so anyone reading `build.mjs` can see the entire site structure in one file. A framework would add real value once the page count or templating complexity grows well past this site's needs, but for seven fixed pages plus one repeating suburb template it would mostly add configuration to learn.

### Admin authentication: a Netlify Function guarding one password, not Netlify Identity or Decap CMS

Netlify Identity was discontinued for new sites, which rules it out for a fresh build. Decap CMS (formerly Netlify CMS) is a full editor UI that expects to own the whole content workflow through a Git-based backend, and skinning it down to the exact 29 text fields and 6 image slots this owner needs would take more work than building a small custom panel and would still show the owner concepts like commits and branches he was never supposed to see. A single Netlify Function that checks one password against an environment variable and issues a signed, httpOnly session cookie is a few dozen lines of code, has no moving parts to maintain, and matches the actual requirement: one owner, one password, no user management.

### Lead storage: Netlify Blobs, not Airtable or a Google Sheet

Airtable's free tier caps records per base and its API requires an API key the owner would need to generate and never lose, and a Google Sheet requires setting up a Google Cloud service account and sharing the sheet with a robot email address, both setup steps a non-technical owner cannot do alone. Netlify Blobs is already part of the hosting plan the site runs on, needs no extra account, no extra API key, and no extra dashboard, and the leads view built into the admin panel reads it directly so the owner never needs to open a third-party tool at all. The tradeoff is that Blobs has no spreadsheet export built in, which is why the admin panel's leads view exists as the reading surface instead of pointing the owner at raw storage.

### Playbook email delivery: Resend, not SendGrid or Postmark

As of 2026, SendGrid's free option is a 60-day trial rather than a permanent free plan, so it would start charging partway through the first year with no code change required to trigger it. Postmark's free allotment is 100 emails a month, which a single training business generating a handful of playbooks a week could plausibly outgrow. Resend's free tier gives 3,000 emails a month at up to 100 a day on one verified sending domain, comfortably covers this site's expected volume indefinitely, and has the simplest API of the three to call from a Netlify Function. If volume ever grows past the daily cap, Postmark's deliverability reputation makes it the natural upgrade path; the playbook function isolates the email call in one function so switching providers later is a small, contained change. The playbook download never depends on the email succeeding: generation and download happen first, the email send is best effort, and a failed send is logged rather than shown to the visitor as an error.
