# Going live

Written 8 August 2026, revised 3 September 2026 after the pricing, enrollment and terms
work landed, again 8 September 2026 to add Step 5, Stripe, and again 9 September 2026 when
the site moved off Netlify onto Firebase Hosting. The launch steps are the same shape; the
host they point at changed.

`FIREBASE.md` is the reference for how the hosting is put together and what each deploy
command does. This file is the ordered checklist for getting the site in front of the public
for the first time.

**The two Netlify-era runbooks are retired.** `phase-c/P10-netlify-deployment-guide.md` and
`phase-c/P11-domain-dns-runbook.md` describe a host this site no longer uses and a domain it
did not end up buying. Do not follow either. Their genuinely portable parts, uptime
monitoring and the habit of previewing before you publish, are covered below and in
`FIREBASE.md`.

---

## What I cannot do, and why

These steps are yours and cannot be delegated:

- **Upgrading the Firebase project to the Blaze plan.** Cloud Functions requires it, and
  billing is yours. The free allowance is 2,000,000 calls a month, so a site this size bills
  nothing, but a card has to be on file.
- **Entering the environment values.** These are secrets: a GitHub token, a session-signing
  key, the Stripe keys, the Resend key. I do not handle credentials, even ones you paste
  to me. Put them in `functions/.env`, which is gitignored.
- **Creating the deploy service account.** `npx firebase-tools init hosting:github` makes it
  and stores it as a repository secret. It signs in as you.
- **Pointing DNS.** The domain is bought; the records are yours to change, and they live in
  the Wix dashboard rather than at a registrar.
- **Creating the Stripe account and its keys.** The money goes to you, so the account is
  yours, and the restricted API key and the webhook signing secret are credentials like the
  ones above. Step 5 lists exactly what to click.

Everything on the code side is done: `main` builds clean, the golden baseline matches, and
`npm test` passes.

---

## Before you start

Two facts to have in front of you.

**The site launches indexable, and the switch has moved.** `netlify.toml` used to set
`ROBOTS_ALLOW` per deploy context; that file is gone. Now `node build.mjs --live` writes an
indexable `robots.txt`, and `npm run deploy` and `npm run deploy:hosting` both pass `--live`.
CI passes `ROBOTS_ALLOW` instead, defaulting to `true`. To pull the site out of search, set a
repository variable `ROBOTS_ALLOW` to `false` and push; that is the whole switch. A plain
`npm run build`, the one `npm run dev` uses, writes `Disallow: /`, which is why a preview
channel is never indexed by accident.

**The phone number and email are deliberately NOT in the public HTML.** Since 14 September 2026
the contact form is the only door: bots were scraping the address and number out of the markup
and spamming Blake. `/terms` is the one exception, because it reproduces the signed training
agreement verbatim and that text carries them. Everywhere else they are gone, and the only place
the site hands them out is the `/api/contact` response to an enquiry that passed the bot filter,
which the page then shows in the confirmation box. Check with
`grep -rlE 'mailto:|sms:\+|686-8371|blake@' dist --include=*.html` — only `terms` should match.

The owner mailbox is `blake@fast-basketball.com`, a Google Workspace account on the domain; the
signed agreement names a personal Gmail, and that address is off every page. The group membership
prices ARE on the page, so the number a parent reads is the number they will expect on the call.

---

## Step 1 — Prepare the Firebase project

The project already exists: **`fast-basketball-b3ebe`**, shared with the coach app.

1. Firebase console → the project → **Usage and billing** → upgrade to **Blaze**. Cloud
   Functions will not deploy on the free Spark plan.
2. **Firestore Database** → create it, in **Native mode**, if it does not exist. Only the
   Admin SDK touches it, and the Admin SDK bypasses security rules, so nothing needs to be
   written for the website's collections.
3. **Storage** → enable it, if Blake will upload photos through the admin panel. Skip it and
   everything else still works; only the media library fails.
4. Check you are signed in on the machine you will deploy from: `npx firebase-tools login`.

> **Never run a bare `firebase deploy` from this folder.** Every npm script passes `--only`.
> `firebase.json` here deliberately carries no `firestore` block, so a deploy from the
> website cannot overwrite the coach app's security rules, which live in
> `fast-basketball-app/firebase/` and carry Blake's real Auth uid.

## Step 2 — Environment values

Copy `functions/.env.example` to `functions/.env` and fill it in. That file is gitignored,
and `firebase deploy --only functions` uploads its values with the function. The
authoritative list of names is the table in `README.md`. The four that matter for launch:

| Variable | Value |
|---|---|
| `ADMIN_SESSION_SECRET` | A long random string, generated once, used nowhere else. It signs the session cookie AND hashes the emailed sign-in code, so changing it signs everyone out and voids any code in flight. |
| `ADMIN_BACKUP_EMAIL` | Optional. A second inbox the `/admin` sign-in code is also sent to, so losing the owner's mailbox cannot lock the panel out for good. |
| `GITHUB_TOKEN` | A **fine-grained** GitHub personal access token, scoped to this one repository, with **Contents: read and write**. The admin panel commits through it. |
| `GITHUB_REPO` | `shaver3josiah/fast-basketball-site` |

Optional, but set them before Step 5: `RESEND_API_KEY` and `PLAYBOOK_FROM_EMAIL` (which must
be a verified sender in Resend). They send the playbook, and they are the only thing that
emails Blake when a family enrols or sends the contact form. Without them a lead is still
recorded and shows in the admin Leads tab, but no alert and no prefilled welcome email
arrive.

The three Stripe values (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
`ENROLL_NOTIFY_EMAIL`) come in Step 5. Leaving them unset is safe: `/enroll` still takes the
whole registration, saves it, emails Blake and tells the parent he will send a payment link.
Nothing is charged and nothing breaks.

Leave `GITHUB_BRANCH` unset; it defaults to `main`, which is correct. `SITE_URL` is not a
function value at all: it is set at build time, and Step 4 covers it.

**Do not set** `PLAYBOOK_FROM_NAME`, `PLAYBOOK_REPLY_TO`, `OWNER_NOTIFY_EMAIL`,
`GA4_MEASUREMENT_ID`, `ADMIN_ALLOWED_EMAIL`, or `PLAYBOOK_RATE_LIMIT_PER_HOUR`. Old runbooks
list them; no code reads any of them.

## Step 3 — Deploy, then check it worked

```bash
npm run deploy
```

That builds an indexable `dist/`, copies the server into `functions/`, and deploys Hosting
and the function together. The site is then live at `https://fast-basketball-b3ebe.web.app`.

Then set up automatic publishing, which is what makes the admin panel's Publish button reach
the live site:

```bash
npx firebase-tools init hosting:github
```

Answer `shaver3josiah/fast-basketball-site`, and **decline its offer to overwrite the
existing workflow file** — `.github/workflows/deploy.yml` is already written. All you want
from it is the `FIREBASE_SERVICE_ACCOUNT_FAST_BASKETBALL_B3EBE` repository secret it creates.

Then, in order:

1. **The site loads** at the `web.app` address, and the homepage renders with images.
2. **`/admin` login works.** There is no password: press "Email me a sign-in code", and a
   6-digit code arrives at the owner mailbox (and `ADMIN_BACKUP_EMAIL` if set), good for ten
   minutes. Pick how long to stay signed in first; "This visit" ends when you close the tab.
   If no code arrives, `RESEND_API_KEY`/`PLAYBOOK_FROM_EMAIL` are missing or the Resend domain
   is unverified. If the code is refused every time, `ADMIN_SESSION_SECRET` is missing. If it
   loads but every save fails, `GITHUB_TOKEN` or `GITHUB_REPO` is wrong.
3. **`/admin/editor.html` loads the canvas**, and the Photos panel lists the site's photos.
4. **Submit the contact form once** and confirm the enquiry appears in the admin Leads tab,
   and that Blake gets the email if Resend is configured. There is no third-party form
   dashboard to switch on any more; `/api/contact` records it and emails him directly.
5. **Publish once from the editor** — make a trivial edit, Save, Publish. Confirm a commit
   lands on `main`, the GitHub Action runs green, and the change appears on the live site.
   That proves the whole staging → publish → deploy path.

## Step 4 — The domain, when you are ready

**The domain is `fast-basketball.com`, bought from Wix, and DNS stays at Wix.** Registrar,
DNS and hosting are three separate jobs: Wix answers what the domain points at, Firebase
serves the site. Wix cannot host this site itself.

1. Firebase console → **Hosting** → **Add custom domain** → `fast-basketball.com`.
2. Firebase gives a **TXT record** to prove ownership. In the Wix dashboard, open
   **Domains → fast-basketball.com → DNS records**, add it, and wait for verification.
3. Firebase then gives **two A records**, plain IPv4 addresses. Add both at the root of the
   domain in the same panel. A root domain cannot use a CNAME, which is exactly why the site
   is on Firebase Hosting rather than a host that only publishes CNAME targets.
4. Repeat for `www.fast-basketball.com` if you want it; Firebase handles that with a CNAME.
5. If the domain is still connected to a Wix site, disconnect it there, or Wix will keep
   serving its own page from those records.
6. Certificates issue automatically and can take up to 24 hours.
7. **The step that is easy to forget:** GitHub → the repo → Settings → Secrets and variables
   → Actions → Variables → set `SITE_URL` to `https://fast-basketball.com`, then push
   anything. Until you do, every canonical URL, the sitemap and the structured data still
   name the `web.app` address. If you deploy by hand instead, set `SITE_URL` in that shell,
   because a live build prints the address it baked in and will otherwise use the default.

## Step 5 — Stripe

Online payment at `/enroll` needs a Stripe account and two secrets. Until they exist the
form still works end to end: the registration is saved, Blake is emailed, and the parent is
told he will send a payment link. So this step does not block launch. It comes after the
domain on purpose: Checkout's "I agree to the terms" box needs a public Terms of service
URL, and that URL lives on your domain.

The code side is built and tested offline. Nothing has called Stripe yet, and nothing can
until you finish the checklist below.

### What you do, in the Stripe dashboard

Stripe has a test mode and a live mode, switched by a toggle at the top. Steps 1 to 5 are
account-wide. Steps 6 and 7 are per mode: do them in test mode first, then again in live
mode when the cutover order below says so.

1. **Create the Stripe account** for FAST Basketball and complete the business profile and
   payouts. The account is yours. I get a restricted key, never the full secret key.
2. **Settings → Business → Public details.** Business name, support phone (503) 686-8371,
   **Terms of service URL `https://fast-basketball.com/terms`**, privacy policy URL
   `https://fast-basketball.com/privacy`. The Terms URL is not optional: every enrollment
   session asks Stripe for the consent box (`consent_collection`), and Stripe refuses to
   create the session until this URL is set. Without it `/enroll` fails on every plan.
3. **Settings → Emails.** Turn on successful-payment receipts and failed-payment emails.
   Stripe sends the receipt; the site never does.
4. **Settings → Billing → Subscriptions and emails.** Smart Retries on. Email customers when
   a payment fails, and let them update their card from that email.
5. **Settings → Billing → Customer portal.** Enable the hosted **login link**. That link is
   how a parent replaces a card, which is the payment policy's "register a new card within
   24 hours". Put it in your welcome email template.
6. **Developers → API keys → Create restricted key.** Name it for the site. Permissions:
   **write** on Checkout Sessions, Customers, Subscriptions, Subscription Schedules,
   **Products and Prices**; none on anything else. Products and Prices must be write, not
   read: the same key runs `npm run stripe:catalog`, which creates the products and prices
   and archives the old price when an amount changes. A read-only key fails on the first line
   it writes and no lookup key ever exists, which makes every checkout a 500. Put it in
   `functions/.env` as `STRIPE_SECRET_KEY`. Keep a copy in the shell you run the catalog
   script from and nowhere else.
7. **Developers → Webhooks → Add endpoint.** URL
   `https://fast-basketball.com/api/stripe-webhook`. Events:
   `checkout.session.completed`, `checkout.session.expired`, `invoice.payment_failed`,
   `customer.subscription.deleted`, `invoice.paid`, `charge.refunded`,
   `charge.dispute.created`. `invoice.paid` is how a recurring monthly instalment or a
   hand-written dashboard invoice is seen; `charge.refunded` and `charge.dispute.created`
   are how money given back is seen. Stripe shows a signing secret for the endpoint; put it
   in `functions/.env` as `STRIPE_WEBHOOK_SECRET`. Test mode and live mode each get their
   own endpoint and their own secret.

`checkout.session.expired` is the one that is easy to skip and worth having: it is how a
family who filled in the whole registration and never paid becomes a follow-up in Blake's
inbox rather than a row nobody looks at.

Optional: `ENROLL_NOTIFY_EMAIL` if enrollment and failed-payment alerts should go somewhere
other than blake@fast-basketball.com (`CONTACT.email`). Alerts also need `RESEND_API_KEY` and
`PLAYBOOK_FROM_EMAIL` from Step 2; without those the enrollment is still recorded and only
the email is skipped.

### The cutover order, test mode then live

Nothing in the repo changes between the two modes. Switching is an environment change plus
one script run and one deploy. Do it in this order.

**Test mode**

1. In `functions/.env`, set `STRIPE_SECRET_KEY` to the **test** restricted key and
   `STRIPE_WEBHOOK_SECRET` to the **test** endpoint's secret.
2. With the test key in the shell, run `npm run stripe:catalog -- --dry-run` and read what it
   will create, then `npm run stripe:catalog`. That makes the products and the eight prices
   under their lookup keys. It is idempotent; running it twice is safe.
3. `npm run deploy:functions` so the function picks up the new values.
4. With the test key in the shell, run `npm run stripe:check`. It verifies the four things
   that silently break enrollment: a lookup key with no active price, a price that drifted
   from `src/lib/plans.mjs`, a missing Terms of service URL, and a webhook endpoint that is
   absent or subscribed to the wrong events. Fix anything it reports before going further.
5. Run the Phase 1 test list from `STRIPE-PLAN.md` with card `4242 4242 4242 4242`: each of
   the eight plan and payment combinations reaches Checkout, the consent box and the
   typed-name field appear, cancelling returns to `/enroll` with the plan preselected and the
   typed answers still there, a tampered plan gets 422, asking for monthly on an Unlimited
   tier gets 422, and the 11th request in 10 minutes gets 429.
6. Run the Phase 2 test list: the same webhook event delivered twice makes one record; card
   `4000 0000 0000 0341` attaches but fails its first invoice and the failed-payment alert
   arrives; a monthly plan shows a schedule of the term's iterations then `release` in the
   dashboard; a request with a bad signature is a 400 that writes nothing; and the admin Leads
   tab shows the enrollment with the right cancel-by date.

**Live mode**

7. Switch the dashboard to live mode. Repeat checklist steps 6 and 7 there: a live restricted
   key and a live webhook endpoint with the same URL and the same seven events. Replace both
   values in `functions/.env`.
8. With the live key in the shell, run `npm run stripe:catalog` again. Live mode has its own
   products and prices; the script creates them.
9. `npm run deploy:functions`, then `npm run stripe:check` with the **live** key. Test mode
   passing proves nothing about live: the products, prices, webhook endpoint and its signing
   secret are all separate, and this is the last chance to find that out cheaply.
10. One real checkout: open `/enroll?plan=eval`, pay the evaluation with a real card, then
   refund it from the dashboard (Payments → that payment → Refund). This is the only live
   test, and it proves the live key, the live webhook and the live catalog agree.

### The five-minute check afterwards

1. On `/enroll`, fill the registration, tick both boxes, pick a plan and submit: Stripe's
   checkout page opens, and the typed-name field on it is where the family signs.
2. That enrollment appears in the admin Leads tab with its plan and amount.
3. Blake has the alert email, with the prefilled welcome email in it.
4. In the Stripe dashboard, that payment's Checkout session shows the terms consent and the
   typed full name. That is the record the agreement's Step 2 asks for.

---

## Step 6 — Search engines

The site has to be *in* an index before ranking means anything, and a new domain with no
inbound links is not found quickly on its own.

**Google: Search Console, and it needs your login.** Add a **Domain** property for
`fast-basketball.com` (the left-hand box, not URL prefix — that one covers only the exact
string). Verification may need no DNS work at all: the domain already carries two
`google-site-verification` TXT records, and Google issues one token per account-and-domain
pair, so signing in as the account that created either one verifies instantly. If it hands
you a new token instead, add it in Wix as a TXT on `@` and leave the existing two alone —
one of them is holding up Blake's email. Then submit `sitemap.xml` and request indexing on
the homepage.

**Bing: import, do not re-verify.** At `bing.com/webmasters`, choose *Import from Google
Search Console* and authorize with the same Google account. Verification and the sitemap
come across; no second DNS record. DuckDuckGo is Bing-fed and follows.

**IndexNow is already wired and needs nothing from you.** Every deploy submits the URLs
whose pages actually changed, in minutes rather than weeks. Bing and Yandex participate;
Google does not, so this is not a substitute for Search Console.

- The key is served at `/0ec211c90d82b90b7b470eb6889ce903.txt`, written into `dist` by the
  build. It is public by design — that file is how IndexNow proves the site is ours — so it
  is in the repo and is not a secret.
- `.github/workflows/deploy.yml` runs `scripts/indexnow.mjs` **after** the Hosting deploy.
  Never before: announcing a URL before it is live gets the old bytes crawled.
- It submits nothing when nothing changed, which is what IndexNow asks for. "0 of 15 page(s)
  changed" in the build log is the normal, healthy line.
- A failed ping warns and leaves the run green. The site is published either way.

**Who announces a change, and the one sharp edge.** `scripts/page-dates.json` is committed,
so whichever build is the FIRST publishing build after a change is the one that sees it:

- **Blake edits content and hits Publish.** The panel commits through the GitHub API, CI is
  the first publishing build, and CI announces. Nothing to do.
- **A developer changes something.** A local `node build.mjs --live` banks the new hashes, and
  you commit that manifest with the change, so CI then finds nothing changed. Run
  `npm run indexnow` from `build/site` once the Hosting workflow goes green: the local build
  already wrote the change list, and the site is live by then.

Only a publishing build writes either file: `--live` or `SITE_ENV=production`. A plain
`npm run build` and the dev server's rebuilds leave both alone, which they did not at first, and
that was a real bug: the dev server spawns a bare `node build.mjs`, inherits the live domain as
`SITE_URL`, and was banking hashes on every file save, so an edit could be marked "already seen"
by a rebuild that deployed nothing.

**One command you may want by hand: `npm run indexnow -- --all`.** It submits every URL in
the *live* sitemap, for seeding an index that has never seen the site or re-seeding one that
lost it. It reads the deployed sitemap, not the local build, so it cannot announce a page
that is not published. It is deliberately not part of a deploy.

**`<lastmod>` in the sitemap is per-page and truthful.** A page's date moves only when its
rendered bytes move, recorded in `scripts/page-dates.json`, which is committed. That file
matters: stamping every page with the build time is worse than emitting nothing, because
Google discards lastmod from any site that reports it inaccurately, and 15 URLs changing on
every deploy is indistinguishable from a site that lies. If you ever see every page restamped
at once, something overwrote that record — only a build for the live host is allowed to.

## Still open

A handful of things launching does not close: training photography, verified reviews, a
Florida attorney reading `/privacy` and `/terms`, and several points in the training
agreement that only Blake can settle.

This repository is public, so those are tracked privately in `docs/owner-open-items.md`
alongside `docs/source-of-truth/terms-qa-report.md`, both at the project root and outside
version control. Check that file before launch.
