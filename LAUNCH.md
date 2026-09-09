# Going live

Written 8 August 2026, revised 3 September 2026 after the pricing, enrollment and terms
work landed, and again 8 September 2026 to add Step 5, Stripe. The launch steps are
unchanged; four facts about the site's state were stale and are corrected below.

**This supersedes `phase-c/P10-netlify-deployment-guide.md` wherever the two disagree.**
P10 was written on 4 August and audited at 92.5/100 against the site as it existed then.
The site has changed a great deal since — a visual editor, a media library, and a
draft/publish split all landed — and five parts of P10 are now wrong in ways that will
cost you time or break the deploy. Those are listed at the bottom. P10 is still worth
reading for the parts this file does not repeat: uptime monitoring, deploy previews,
enforcing the CSP, and the rollback procedure.

---

## What I cannot do, and why

Five of the steps below are yours and cannot be delegated to me:

- **Creating the Netlify account and site.** Account creation and accepting terms of
  service are yours to do.
- **Entering the environment variables.** These are secrets — a GitHub token, an admin
  password, a session-signing key, the Stripe keys. I do not handle credentials, even ones
  you paste to me. Generate them and enter them directly in the Netlify dashboard.
- **Pointing DNS.** The domain is bought; the records are yours to change, and they live
  in the Wix dashboard rather than at a registrar.
- **Creating the Stripe account and its keys.** The money goes to you, so the account is
  yours, and the restricted API key and the webhook signing secret are credentials like
  the ones above. Step 5 lists exactly what to click.

Everything on the code side is done: `main` builds clean, the golden baseline matches, and
the branch contains the editor, the media library, and the publish split.

---

## Before you start

Two facts to have in front of you.

**The site is set to launch indexable.** `netlify.toml` sets `ROBOTS_ALLOW = "true"` in the
production context, so Google is allowed in from the first production deploy. That was a
deliberate choice. If you change your mind, set it to `"false"` and redeploy — that is the
whole switch, no other file changes.

**The phone number and email are now real and public.** The site publishes
(503) 686-8371 and blake.kingsley@gmail.com, both taken from the signed training agreement.
Two consequences worth knowing before the first indexable deploy. A personal Gmail on an
indexed page gets scraped and will attract spam, so a forwarding address on the domain is
worth setting up when you buy it. And every price is now on the page, so the number a
parent reads on the site is the number they will expect on the enrollment call.

---

## Step 1 — Create the Netlify site

1. app.netlify.com → **Add new project** → **Import an existing project** → GitHub.
2. Authorise Netlify for `shaver3josiah/fast-basketball-site`. The repo is public, so Netlify
   needs no special grant beyond the usual GitHub authorisation.
3. Pick branch **`main`**. It is current as of this writing and contains everything.
4. Leave the build settings alone. Netlify reads them from `netlify.toml`:
   build `npm run build`, publish `dist`, functions `netlify/functions`, Node 22,
   `NPM_FLAGS = --include=dev` (the build needs `sharp`, which is a devDependency).
5. **Do not deploy yet** if Netlify offers. Set the variables first — the first build works
   either way, but the admin panel will not until Step 2.

## Step 2 — Environment variables

Site configuration → Environment variables. The authoritative list is the table in
`README.md`. The five that matter for launch:

| Variable | Value |
|---|---|
| `ADMIN_PASSWORD` | A password you choose. This alone unlocks `/admin`. Make it long. |
| `ADMIN_SESSION_SECRET` | A long random string, generated once, used nowhere else. |
| `GITHUB_TOKEN` | A **fine-grained** GitHub personal access token, scoped to this one repository, with **Contents: read and write**. The admin panel commits through it. |
| `GITHUB_REPO` | `shaver3josiah/fast-basketball-site` |
| `SITE_URL` | **Leave unset for now.** Netlify's automatic `URL` is used ahead of the default, so canonicals and the sitemap will correctly point at your `.netlify.app` address until a domain exists. Set it the day the domain goes live, and not before. |

Optional, but set them before Step 5: `RESEND_API_KEY` and `PLAYBOOK_FROM_EMAIL`
(must be a verified sender in Resend). They send the playbook, and they are also the only
thing that emails Blake when a family enrolls. Without them an enrollment is still recorded
and shows in the admin Leads tab, but no alert and no prefilled welcome email arrive.

The three Stripe variables (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
`ENROLL_NOTIFY_EMAIL`) come in Step 5. Leaving them unset is safe: `/enroll` still loads
and shows the plans, and a parent who tries to submit is told online enrollment opens soon
and given Blake's number. Nothing is charged and nothing breaks.

Leave `GITHUB_BRANCH` unset — it defaults to `main`, which is correct.
Leave `NETLIFY_BUILD_HOOK_URL` unset. It only makes two older save paths spend a deploy
immediately, and nothing needs it.

**Do not set** `PLAYBOOK_FROM_NAME`, `PLAYBOOK_REPLY_TO`, `OWNER_NOTIFY_EMAIL`,
`GA4_MEASUREMENT_ID`, `ADMIN_ALLOWED_EMAIL`, or `PLAYBOOK_RATE_LIMIT_PER_HOUR`. P10's table
lists them; no code reads any of them. Two are actively misleading and are covered below.

## Step 3 — Deploy, then check it worked

Trigger the first deploy. Then, in order:

1. **The site loads** at the `.netlify.app` address, and the homepage renders with images.
2. **`/admin/` login works** with `ADMIN_PASSWORD`. If it 401s, `ADMIN_SESSION_SECRET` is
   missing. If it loads but every save fails, `GITHUB_TOKEN` or `GITHUB_REPO` is wrong.
3. **`/admin/editor.html` loads the canvas**, and the Photos panel lists the site's photos.
4. **Submit the contact form once.** Netlify only registers a form after it sees a real
   submission on a deployed build. Then go to Forms → contact → **set the notification
   email**, or nobody is told when a parent gets in touch.
5. **Publish once from the editor** — make a trivial edit, Save, Publish. Confirm a commit
   lands on `main` and a single deploy runs. That proves the whole staging→publish path.

## Step 4 — The domain, when you are ready

`phase-c/P11-domain-dns-runbook.md` has the DNS mechanics and they are still correct:
ALIAS/A on the apex to Netlify's load balancer, CNAME on `www`, a CAA record locking
certificate issuance. Follow it for the records.

**Ignore P11's domain recommendation.** It recommends `fastbasketballmiami.com` for
Miami-Dade local SEO. The business moved to north Broward on 5 August — the day after P11
was written — and twelve Miami-Dade city pages now redirect to `/#areas`. Buying a Miami
domain today would misname the business.

**The domain is bought: `fast-basketball.com`, from Wix.** As of `171dbd3` it is the
fallback in `src/lib/site-config.mjs`, so canonicals, the sitemap and the structured data
are already right with no environment variable set. One consequence the runbook does not
cover: **DNS is at Wix**, so pointing the domain at Netlify means changing nameservers or
records in the Wix dashboard, not at a registrar.

Once the domain resolves: add it in Netlify, let the certificate issue, then set `SITE_URL`
to `https://yourdomain.com` and redeploy so canonicals, the sitemap and the structured data
all agree.

## Step 5 — Stripe

Online enrollment at `/enroll` needs a Stripe account and two secrets in Netlify. Until
they exist the page loads and shows the plans, and submitting the form answers "online
enrollment opens soon" with Blake's number, so this step does not block launch. It comes after the domain on purpose: Checkout's "I agree to the terms"
box needs a public Terms of service URL, and that URL lives on your domain.

The code side is built and tested offline (`STRIPE-PLAN.md`, Phases 1 and 2, and the two
Phase 3 items that shipped). Nothing has
called Stripe yet, and nothing can until you finish the checklist below.

### What you do, in the Stripe dashboard

Adapted from `STRIPE-PLAN.md`, Phase 0. Stripe has a test mode and a live mode, switched
by a toggle at the top of the dashboard. Steps 1 to 5 are account-wide. Steps 6 and 7 are
per mode: do them in test mode first, then again in live mode when the cutover order below
says so.

1. **Create the Stripe account** for FAST Basketball and complete the business profile and
   payouts. The account is yours. I get a restricted key, never the full secret key.
2. **Settings → Business → Public details.** Business name, support phone (503) 686-8371,
   **Terms of service URL `https://fast-basketball.com/terms`**, privacy policy URL
   `https://fast-basketball.com/privacy`. The Terms URL is not optional: every
   enrollment session asks Stripe for the consent box (`consent_collection`), and Stripe
   refuses to create the session until this URL is set. Without it `/enroll` fails on
   every plan.
3. **Settings → Emails.** Turn on successful-payment receipts and failed-payment emails.
   Stripe sends the receipt; the site never does.
4. **Settings → Billing → Subscriptions and emails.** Smart Retries on. Email customers
   when a payment fails, and let them update their card from that email.
5. **Settings → Billing → Customer portal.** Enable the hosted **login link**. That link is
   how a parent replaces a card, which is the payment policy's "register a new card within
   24 hours". Put it in your welcome email template.
6. **Developers → API keys → Create restricted key.** Name it for the site. Permissions:
   **write** on Checkout Sessions, Customers, Subscriptions, Subscription Schedules,
   **Products and Prices**; none on anything else. Products and Prices must be write, not
   read: the same key runs `npm run stripe:catalog`, which creates the products and prices
   and archives the old price when an amount changes. A read-only key fails on the first
   line it writes and no lookup key ever exists, which makes every checkout a 500. Enter it
   in Netlify as `STRIPE_SECRET_KEY`. Keep a copy in the shell you run the catalog script
   from and nowhere else.
7. **Developers → Webhooks → Add endpoint.** URL
   `https://fast-basketball.com/.netlify/functions/stripe-webhook`. Events:
   `checkout.session.completed`, `invoice.payment_failed`,
   `customer.subscription.deleted`. Stripe shows a signing secret for the endpoint; enter
   it in Netlify as `STRIPE_WEBHOOK_SECRET`. Test mode and live mode each get their own
   endpoint and their own secret.

Optional: `ENROLL_NOTIFY_EMAIL` in Netlify if enrollment and failed-payment alerts should
go somewhere other than blake.kingsley@gmail.com. They also need `RESEND_API_KEY` and
`PLAYBOOK_FROM_EMAIL` from Step 2; without those the enrollment is still recorded and only
the email is skipped.

### The cutover order, test mode then live

Nothing in the repo changes between the two modes. Switching is an environment change
plus one script run. Do it in this order.

**Test mode**

1. In Netlify, set `STRIPE_SECRET_KEY` to the **test** restricted key and
   `STRIPE_WEBHOOK_SECRET` to the **test** endpoint's secret.
2. With the test key in the shell, run `npm run stripe:catalog -- --dry-run` and read what
   it will create, then `npm run stripe:catalog`. That makes the six products and eight
   prices under their lookup keys. It is idempotent; running it twice is safe.
3. Trigger a deploy so the functions pick up the variables.
4. Run the Phase 1 test list from `STRIPE-PLAN.md` with card `4242 4242 4242 4242`: each
   of the eight plan and payment combinations reaches Checkout, the consent box and the
   typed-name field appear, cancelling returns to `/enroll` with the plan preselected, a
   tampered plan gets 422, asking for monthly on an Unlimited tier gets 422, the 11th
   request in 10 minutes gets 429, and with JavaScript off the form still reaches Stripe.
5. Run the Phase 2 test list: the same webhook event delivered twice makes one record;
   card `4000 0000 0000 0341` attaches but fails its first invoice and the failed-payment
   alert arrives; a monthly plan shows a schedule of the term's iterations then `release`
   in the dashboard; a request with a bad signature is a 400 that writes nothing; the admin
   Leads tab shows the enrollment with the right cancel-by date.

**Live mode**

6. Switch the dashboard to live mode. Repeat checklist steps 6 and 7 there: a live
   restricted key and a live webhook endpoint with the same URL and the same three events.
   Replace both values in Netlify.
7. With the live key in the shell, run `npm run stripe:catalog` again. Live mode has its
   own products and prices; the script creates them.
8. Trigger a deploy.
9. One real checkout: open `/enroll?plan=eval`, pay the $50 evaluation with a real card,
   then refund it from the dashboard (Payments → that payment → Refund). This is the only
   live test, and it proves the live key, the live webhook and the live catalog agree.

### The five-minute check afterwards

1. On `/enroll`, pick a plan, enter an email, tick the guardian box and submit: Stripe's
   checkout page opens. (The plan matrix is what the page always shows, key or no key, so
   only a submit proves Stripe is configured.)
2. The enrollment from step 9 appears in the admin Leads tab with its plan and amount.
3. Blake has the alert email, with the prefilled welcome email in it.
4. In the Stripe dashboard, that payment's Checkout session shows the terms consent and
   the typed full name. That is the record the agreement's Step 2 asks for.

---

## Where P10 is now wrong

1. **Part 6, Netlify Identity and Git Gateway — ignore it entirely.** There is no Identity
   here and nobody to invite. Admin auth is a password plus an HMAC-signed cookie
   (`netlify/functions/lib/auth.mjs`), chosen because Netlify Identity was discontinued for
   new sites. Steps 2 and 3 above replace this part completely.
2. **Part 3's variable table is for that other auth model.** It omits `GITHUB_TOKEN`,
   `GITHUB_REPO`, `ADMIN_PASSWORD` and `ADMIN_SESSION_SECRET` — the four things everything
   now depends on — and lists six variables no code reads.
3. **Step 32 refers to `.env.example`.** No such file exists. `README.md`'s table is the
   source of truth for variable shapes.
4. **Step 46's troubleshooting names the wrong path.** `included_files` is
   `["src/data/**", "src/templates/**"]`, not `src/_data/playbook/**`.
5. **Part 11's cached-path list is wrong.** The one-year immutable cache covers
   `/images/*`, `/fonts/*`, `/styles/*` and `/js/*`. There is no `/assets/*`, and the
   runbook omits `/styles/*` and `/js/*`.

## Two things that do not work the way the runbook implies

- **Nothing emails you when a playbook lead arrives.** P10's table implies an
  `OWNER_NOTIFY_EMAIL` alert. There is no such code. Playbook leads land in Netlify Blobs
  and surface only in the admin panel's Leads tab, so you have to go and look. Contact-form
  submissions are different — those are Netlify Forms, and Step 3.4 above is what turns
  their notification on.
- **The playbook rate limit is not configurable.** It is hardcoded at 6 requests per 10
  minutes per IP in `netlify/functions/playbook.mjs`. Setting
  `PLAYBOOK_RATE_LIMIT_PER_HOUR` does nothing.

---

## Still open

A handful of things launching does not close: training photography, verified reviews, a
Florida attorney reading `/privacy` and `/terms`, and several points in the training
agreement that only Blake can settle.

This repository is public, so those are tracked privately in `docs/owner-open-items.md`
alongside `docs/source-of-truth/terms-qa-report.md`, both at the project root and outside
version control. Check that file before launch.
