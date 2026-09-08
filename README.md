# Fast Basketball Website

This is the source code for the Fast Basketball website. If you are the site owner and you just want to edit words or photos, you do not need anything in this file. Open `admin/OWNER-GUIDE.md` instead, or go to yoursite.com/admin.

This file is for whoever sets up or maintains the code.

## What this is

A static website. There is no database and no server that runs all the time. A build step turns the files in `src/` into plain HTML, CSS, and JavaScript files in `dist/`, and Netlify serves those files to visitors. A small number of Netlify Functions handle the contact playbook generator, the content admin panel, and enrollment payments through Stripe (one function creates the Checkout session, one receives Stripe's webhook).

## Running it on your own computer

You need Node.js version 20 or newer installed.

1. Open a terminal in this folder.
2. Run `npm install`. This downloads the few packages the build and the functions use.
3. Run `npm run build`. This creates the `dist/` folder with the full site inside it.
4. Run `npm run dev` to view it in a browser at `http://localhost:8899`. This serves `dist/` and runs the functions in `netlify/functions/` locally, with leads written to `.local/leads.json` instead of Netlify Blobs.

If you change anything in `src/data/content.json`, `src/data/suburbs.json`, or `src/data/playbook-templates.json`, run `npm run build` again to see the change.

Three more commands you will need:

- `npm test` runs every `*.test.mjs` file under `src/lib`, `src`, `netlify/functions` and `netlify/functions/lib`. Everything runs offline; no test calls Stripe or any other service.
- `npm run stripe:catalog` (that is `node scripts/stripe-catalog.mjs`) creates the products and prices in Stripe from the catalog in `src/lib/plans.mjs`, each price under a `lookup_key` the functions look up at request time. It needs `STRIPE_SECRET_KEY` set in the shell you run it from, never in a file. It is idempotent, so run it again after any price change, and `--dry-run` prints what it would do without writing anything. Run it once per mode, test first and live at cutover.
- Local webhook testing needs the Stripe CLI: `stripe listen --forward-to localhost:8899/.netlify/functions/stripe-webhook`, then `stripe trigger checkout.session.completed` in a second terminal. Put the signing secret the CLI prints into `STRIPE_WEBHOOK_SECRET` in the shell that runs `npm run dev`. Records land in `.local/leads.json`.

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
scripts/                    extraction, splitting, validation, image tooling, and the Stripe catalog script
src/data/                   content.json, suburbs.json, playbook-templates.json
src/templates/sections/     the seven homepage sections, extracted from the preview
src/lib/                    shared rendering and content logic, and plans.mjs, the Stripe catalog
src/styles/                 tokens.css, base.css, fonts.css, site.css
src/images/source/          original extracted photographs, byte for byte
src/fonts/                  self-hosted font files
src/js/                     the small amount of public-facing JavaScript
admin/                      the content admin panel, deployed to /admin
netlify/functions/          serverless functions: playbook, admin auth, uploads, leads, checkout, stripe-webhook
dist/                       build output, not committed to git
```

## Environment variables

Set these in the Netlify dashboard under Site configuration, Environment variables. Never put real values in this repository.

| Variable | Holds |
|---|---|
| `SITE_URL` | Overrides the site's public URL. Used in canonicals, the sitemap, and structured data. Leave it unset unless the domain changes: `src/lib/site-config.mjs` already defaults to the production domain `https://fast-basketball.com`, and Netlify's automatic `URL` variable (the `.netlify.app` address) is used ahead of that default on deploys where no custom domain is attached. |
| `ADMIN_PASSWORD` | The single password that unlocks /admin. |
| `ADMIN_SESSION_SECRET` | A long random string used to sign the admin login cookie. Generate once, never reuse elsewhere. |
| `GITHUB_TOKEN` | A fine-grained GitHub personal access token, write access to this one repository only. Lets the admin panel commit content and photo changes. |
| `GITHUB_REPO` | The repository in `owner/name` form. For this site: `shaver3josiah/fast-basketball-site`. |
| `GITHUB_BRANCH` | The branch the site deploys from. Defaults to `main` if not set, which is the branch this site deploys from, so it can normally be left unset. |
| `NETLIFY_BUILD_HOOK_URL` | Optional, and deliberately narrow. Only `admin-content.mjs` (hand-built section saves) and the add-a-resume-card path in `admin-upload.mjs` call it. The canvas editor and the media library never do — they stage their work and commit once on Publish, which is what keeps a batch of edits down to one deploy. Setting this makes those two older paths trigger a build immediately. |
| `RESEND_API_KEY` | API key for the Resend transactional email service. Used to email the generated playbook, and now also the enrollment and failed-payment alerts to the coach. |
| `PLAYBOOK_FROM_EMAIL` | The from address playbook emails and enrollment alerts are sent from, for example `playbook@fast-basketball.com`. Must be a verified sender in Resend. |
| `STRIPE_SECRET_KEY` | A **restricted** API key from Blake's Stripe account, never the full secret key: write access on Checkout Sessions, Customers, Subscriptions, Subscription Schedules, Products and Prices. Products and Prices are write rather than read because the same key runs `npm run stripe:catalog`, which creates them. Use the test-mode key first and swap in the live key at cutover (`LAUNCH.md`, Step 5). While it is unset, the checkout function answers 503 `{"error":"payments not configured"}` and `/enroll` tells the parent online enrollment opens soon when they submit the form; the page itself always shows the plans. |
| `STRIPE_WEBHOOK_SECRET` | The signing secret of the webhook endpoint registered in Stripe as `https://<site>/.netlify/functions/stripe-webhook`, subscribed to `checkout.session.completed`, `invoice.payment_failed` and `customer.subscription.deleted`. Test mode and live mode each have their own endpoint and their own secret. |
| `ENROLL_NOTIFY_EMAIL` | Optional. Where enrollment and failed-payment alerts go. Defaults to the coach's published email, `CONTACT.email` in `src/lib/site-config.mjs`. |

If `RESEND_API_KEY` or `PLAYBOOK_FROM_EMAIL` are missing, the playbook function still generates and returns the document. It just skips sending the email and reports that in its response, so a visitor's download never depends on email working. The same holds for enrollment: the webhook still saves the record, and only the alert email is skipped. That record is not marked `notified`, so re-sending the event from Stripe's dashboard sends the alert once the keys exist.

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

### Payments: Stripe Checkout, hosted, not Elements

Parents pay on a page Stripe serves, reached by a redirect from `/enroll`, rather than on a card form embedded in the site. The first reason is that the site ships no third-party script at all, and the Content-Security-Policy and the performance budget were both measured on that basis; Stripe Elements or embedded Checkout would put `js.stripe.com` in `script-src`, `frame-src` and `connect-src` and loosen `Permissions-Policy`, while hosted Checkout needs none of that and keeps card numbers off any page this site serves. The second is that Checkout can express the signed training agreement natively: its consent box (`consent_collection`) is the "tick the I agree box" and a custom text field is the "type your full name to agree", both stored on the session where Blake can show them in a dispute, with no form of our own to build or defend. The third is that receipts, failed-card retries, dunning emails and the customer portal for card updates are all dashboard settings, so the payment policy's "replace your card within 24 hours" costs no code. Prices live in Stripe under lookup keys generated from `src/lib/plans.mjs`, and `scripts/stripe-catalog.mjs` is the only path that changes a charge; the price text the owner can edit on the programs page is cosmetic and must be kept in step by hand. The webhook is the source of truth: it alone writes the enrollment record and sends the alert, and the `/enroll/thanks` page is copy that proves nothing, because anyone can type its address.
