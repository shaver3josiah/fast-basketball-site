# Fast Basketball Website

This is the source code for the Fast Basketball website. If you are the site owner and you just want to edit words or photos, you do not need anything in this file. Open `admin/OWNER-GUIDE.md` instead, or go to yoursite.com/admin.

This file is for whoever sets up or maintains the code.

## What this is

A static website. There is no database and no server that runs all the time. A build step turns the files in `src/` into plain HTML, CSS, and JavaScript files in `dist/`, and Firebase Hosting serves those files to visitors. One Cloud Function, reached at `/api/**`, handles the contact form, the playbook generator, the content admin panel, and enrollment payments through Stripe (one endpoint creates the Checkout session, one receives Stripe's webhook).

The site ran on Netlify until September 2026. `FIREBASE.md` records what moved and why, and is the runbook for deploying and for pointing the domain at it.

## Running it on your own computer

You need Node.js version 20 or newer for the build. The deployed function runs on Node 22.

1. Open a terminal in this folder.
2. Run `npm install`. This downloads the few packages the build and the endpoints use.
3. Run `npm run build`. This creates the `dist/` folder with the full site inside it.
4. Run `npm run dev` to view it in a browser at `http://localhost:8899`. This serves `dist/` and runs the handlers in `server/functions/` locally, with leads written to `.local/leads.json` instead of Firestore.

Local development needs no Firebase account, no emulator and no network. `FB_LOCAL=true` sends every write to that JSON file, which is why a fresh clone runs offline.

If you change anything in `src/data/content.json`, `src/data/suburbs.json`, or `src/data/playbook-templates.json`, run `npm run build` again to see the change.

Three more commands you will need:

- `npm test` runs every `*.test.mjs` file under `src/lib`, `src`, `scripts`, `server/functions/tests` and `server/functions/lib`. Everything runs offline; no test calls Stripe, Firebase or any other service.
- `npm run stripe:catalog` (that is `node scripts/stripe-catalog.mjs`) creates the products and prices in Stripe from the catalog in `src/lib/plans.mjs`, each price under a `lookup_key` the endpoints look up at request time. It needs `STRIPE_SECRET_KEY` set in the shell you run it from, never in a file. It is idempotent, so run it again after any price change, and `--dry-run` prints what it would do without writing anything. Run it once per mode, test first and live at cutover.
- `npm run stripe:check` asks Stripe whether it can actually take an enrollment: every lookup key resolves to an active price at the amount `src/lib/plans.mjs` promises, the account has the Terms of service URL that `consent_collection` requires, and a webhook endpoint is subscribed to all four events the handler acts on. It needs `STRIPE_SECRET_KEY` in the shell, reports every problem at once, and exits non-zero if any of them fails. Run it once per mode.
- Local webhook testing needs the Stripe CLI: `stripe listen --forward-to localhost:8899/api/stripe-webhook`, then `stripe trigger checkout.session.completed` in a second terminal. Put the signing secret the CLI prints into `STRIPE_WEBHOOK_SECRET` in the shell that runs `npm run dev`. Records land in `.local/leads.json`.

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
firebase.json               hosting config: headers, redirects, the /api rewrite
.firebaserc                 which Firebase project to deploy to
.github/workflows/          builds and deploys Hosting on a push to main
scripts/                    extraction, splitting, validation, image tooling, the Stripe catalog script,
                            and functions-pack.mjs, which copies the server into functions/ before a deploy
src/data/                   content.json, suburbs.json, playbook-templates.json
src/templates/sections/     the homepage sections, extracted from the preview
src/lib/                    shared rendering and content logic, plans.mjs (the Stripe catalog),
                            and registration.mjs (the enrollment form's fields and validation)
src/styles/                 tokens.css, base.css, fonts.css, site.css
src/images/source/          original extracted photographs, byte for byte
src/fonts/                  self-hosted font files
src/js/                     the small amount of public-facing JavaScript
admin/                      the content admin panel, deployed to /admin
server/router.mjs           maps the first path segment of /api/<name> to a handler
server/functions/           the handlers: contact, playbook, admin auth, uploads, leads, checkout, stripe-webhook
functions/                  the Cloud Function Firebase deploys. Only package.json and index.mjs are
                            committed; server/ and src/ appear here as generated copies at deploy time
dist/                       build output, not committed to git
```

`server/functions/` holds ordinary handler code: each one takes a web `Request` and returns a `Response`. `functions/index.mjs` is the only file that knows it is running on Firebase, and it translates between Cloud Functions' Express objects and that pair. Edit the originals under `server/` and `src/`; the copies inside `functions/` are written by `npm run pack:functions` and are gitignored, because a committed copy would go stale without anyone noticing.

## Environment variables

The deployed function reads these from `functions/.env`, which is gitignored. Copy `functions/.env.example` and fill it in. `firebase deploy --only functions` uploads the values with the function. Never put real values in this repository.

For stronger protection on the three that matter most, move them to Secret Manager later with `npx firebase-tools functions:secrets:set NAME` and declare them in the `onRequest` options in `functions/index.mjs`.

| Variable | Holds |
|---|---|
| `SITE_URL` | The site's public URL. Used in canonicals, the sitemap, and structured data. This is a **build-time** variable, not a function one: `.github/workflows/deploy.yml` passes it, defaulting to the `web.app` address. Set a repository variable `SITE_URL` to `https://fast-basketball.com` on the day the domain moves. `src/lib/site-config.mjs` falls back to the production domain if nothing is set. |
| `ADMIN_PASSWORD` | The single password that unlocks /admin. |
| `ADMIN_SESSION_SECRET` | A long random string used to sign the admin login cookie. Generate once, never reuse elsewhere. |
| `GITHUB_TOKEN` | A fine-grained GitHub personal access token, write access to this one repository only. Lets the admin panel commit content and photo changes. |
| `GITHUB_REPO` | The repository in `owner/name` form. For this site: `shaver3josiah/fast-basketball-site`. |
| `GITHUB_BRANCH` | The branch the site deploys from. Defaults to `main` if not set, which is the branch this site deploys from, so it can normally be left unset. |
| `RESEND_API_KEY` | API key for the Resend transactional email service. Used to email the generated playbook, and the enrollment, enquiry and failed-payment alerts to the coach. |
| `PLAYBOOK_FROM_EMAIL` | The from address playbook emails and enrollment alerts are sent from, for example `playbook@fast-basketball.com`. Must be a verified sender in Resend. |
| `STRIPE_SECRET_KEY` | A **restricted** API key from Blake's Stripe account, never the full secret key: write access on Checkout Sessions, Customers, Subscriptions, Subscription Schedules, Products and Prices. Products and Prices are write rather than read because the same key runs `npm run stripe:catalog`, which creates them. Use the test-mode key first and swap in the live key at cutover (`LAUNCH.md`, Step 5). While it is unset, `/enroll` still saves the registration and emails the coach, then tells the parent online payment opens soon and he will send a link. |
| `STRIPE_WEBHOOK_SECRET` | The signing secret of the webhook endpoint registered in Stripe as `https://<site>/api/stripe-webhook`, subscribed to `checkout.session.completed`, `checkout.session.expired`, `invoice.payment_failed` and `customer.subscription.deleted`. Test mode and live mode each have their own endpoint and their own secret. |
| `ENROLL_NOTIFY_EMAIL` | Optional. Where enrollment, enquiry and failed-payment alerts go. Defaults to the coach's published email, `CONTACT.email` in `src/lib/site-config.mjs`. |

If `RESEND_API_KEY` or `PLAYBOOK_FROM_EMAIL` are missing, the playbook endpoint still generates and returns the document. It just skips sending the email and reports that in its response, so a visitor's download never depends on email working. The same holds for enrollment: the record is still saved, and only the alert email is skipped. That record is not marked `notified`, so re-sending the event from Stripe's dashboard sends the alert once the keys exist.

## Deploying

`npm run deploy` builds the site and deploys Hosting and the function together. `npm run deploy:hosting` is the content-only path, and it is what CI runs.

Pushing to `main` deploys Hosting through `.github/workflows/deploy.yml`. That workflow is not a convenience: Firebase does not rebuild on a push the way Netlify did, and the admin panel's Publish button works by committing through the GitHub API, so removing the workflow would leave Publish committing to git and never reaching the live site.

Never run a bare `firebase deploy` from this folder. The npm scripts always pass `--only`. `firebase.json` here deliberately carries no `firestore` block so that a deploy from the website cannot overwrite the coach app's Firestore security rules, which live in a different folder and carry Blake's real Auth uid.

Full setup, including the DNS records to paste into Wix, is in `FIREBASE.md`.

## Technical decisions

These are the choices made when this site was built and why, kept here so a future maintainer does not have to re-derive them. Where the September 2026 move off Netlify changed one, the entry says so rather than being quietly rewritten.

### Static site generation: a plain Node build script instead of a framework

The build is a Node script (`build.mjs`) that reads JSON and HTML template files and writes plain HTML to `dist/`, with no framework such as Eleventy or Astro in between. This keeps the dependency list to almost nothing, which keeps installs and CI build times short. It also makes the suburb page generator trivial to reason about: it is a for loop over `suburbs.json` calling one render function per record, so anyone reading `build.mjs` can see the entire site structure in one file. A framework would add real value once the page count or templating complexity grows well past this site's needs, but for seven fixed pages plus one repeating suburb template it would mostly add configuration to learn.

### Server code: portable handlers behind one thin host adapter

Every handler in `server/functions/` takes a web `Request` and returns a `Response`, the interface the platform gave us on Netlify and the one the web has standardised on. That turned out to be worth more than it cost: when the site moved to Firebase in September 2026, twelve functions became one Cloud Function and not a single handler body had to be rewritten. `functions/index.mjs` converts Express's objects into a `Request` and writes the `Response` back, and `server/router.mjs` picks the handler out of the path. If the host ever changes again, those two files are the whole port.

### Admin authentication: one password checked server-side, not a hosted identity product or a CMS

Netlify Identity was discontinued for new sites, and its equivalents elsewhere are user-management systems for a site with exactly one user. Decap CMS (formerly Netlify CMS) is a full editor UI that expects to own the whole content workflow through a Git-based backend, and skinning it down to the exact text fields and image slots this owner needs would take more work than building a small custom panel and would still show the owner concepts like commits and branches he was never supposed to see. An endpoint that checks one password against an environment variable and issues a signed, httpOnly session cookie is a few dozen lines of code, has no moving parts to maintain, and matches the actual requirement: one owner, one password, no user management.

### Lead storage: the host's own key/value store, not Airtable or a Google Sheet

Airtable's free tier caps records per base and its API requires an API key the owner would need to generate and never lose, and a Google Sheet requires setting up a Google Cloud service account and sharing the sheet with a robot email address, both setup steps a non-technical owner cannot do alone. Storage that comes with the hosting needs no extra account, no extra API key, and no extra dashboard, and the leads view built into the admin panel reads it directly so the owner never needs to open a third-party tool at all. The tradeoff is no spreadsheet export built in, which is why the admin panel's leads view exists as the reading surface, with a CSV button on it, instead of pointing the owner at raw storage.

This was Netlify Blobs until September 2026 and is Firestore now, behind `server/functions/lib/blobs.mjs`. That module deliberately exposes the same small slice of the old Blobs API the callers already used, so the swap changed one import line in each of them. Staged photo uploads are the exception: they are capped at 8MB and a Firestore document stops at 1MB, so those bytes go to Cloud Storage.

### Playbook email delivery: Resend, not SendGrid or Postmark

As of 2026, SendGrid's free option is a 60-day trial rather than a permanent free plan, so it would start charging partway through the first year with no code change required to trigger it. Postmark's free allotment is 100 emails a month, which a single training business generating a handful of playbooks a week could plausibly outgrow. Resend's free tier gives 3,000 emails a month at up to 100 a day on one verified sending domain, comfortably covers this site's expected volume indefinitely, and has the simplest API of the three to call from a serverless handler. If volume ever grows past the daily cap, Postmark's deliverability reputation makes it the natural upgrade path; `server/functions/lib/notify.mjs` isolates the email call in one place so switching providers later is a small, contained change. The playbook download never depends on the email succeeding: generation and download happen first, the email send is best effort, and a failed send is logged rather than shown to the visitor as an error.

### Forms: our own endpoints, not a hosted form service

The contact and playbook forms were Netlify Forms until September 2026, which captured a submission with no server code of ours at all. Firebase has no equivalent, so `server/functions/contact.mjs` and `server/functions/playbook.mjs` handle them now. The replacement is better in one way worth keeping: an enquiry lands in the same leads store as an enrollment and a playbook request, so the admin panel shows all three together instead of sending the owner to a dashboard on another company's site. Both accept JSON from the page's own script and a plain urlencoded form post from a browser with JavaScript off, answering the second with a redirect back to the success box.

### Payments: Stripe Checkout, hosted, not Elements

Parents pay on a page Stripe serves, reached by a redirect from `/enroll`, rather than on a card form embedded in the site. The first reason is that the site ships no third-party script at all, and the Content-Security-Policy and the performance budget were both measured on that basis; Stripe Elements or embedded Checkout would put `js.stripe.com` in `script-src`, `frame-src` and `connect-src` and loosen `Permissions-Policy`, while hosted Checkout needs none of that and keeps card numbers off any page this site serves. The second is that Checkout can express the signed training agreement natively: its consent box (`consent_collection`) is the "tick the I agree box" and a custom text field is the "type your full name to agree", both stored on the session where Blake can show them in a dispute. The third is that receipts, failed-card retries, dunning emails and the customer portal for card updates are all dashboard settings, so the payment policy's "replace your card within 24 hours" costs no code. Prices live in Stripe under lookup keys generated from `src/lib/plans.mjs`, and `scripts/stripe-catalog.mjs` is the only path that changes a charge; the price text the owner can edit on the programs page is cosmetic and must be kept in step by hand. The webhook is the source of truth for payment: it confirms the enrollment record and sends the alert, and the `/enroll/thanks` page is copy that proves nothing, because anyone can type its address.
