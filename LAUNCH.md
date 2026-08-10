# Going live

Written 8 August 2026, against the code as it stands on `main` at the time of writing.

**This supersedes `phase-c/P10-netlify-deployment-guide.md` wherever the two disagree.**
P10 was written on 4 August and audited at 92.5/100 against the site as it existed then.
The site has changed a great deal since — a visual editor, a media library, and a
draft/publish split all landed — and five parts of P10 are now wrong in ways that will
cost you time or break the deploy. Those are listed at the bottom. P10 is still worth
reading for the parts this file does not repeat: uptime monitoring, deploy previews,
enforcing the CSP, and the rollback procedure.

---

## What I cannot do, and why

Four of the steps below are yours and cannot be delegated to me:

- **Creating the Netlify account and site.** Account creation and accepting terms of
  service are yours to do.
- **Entering the environment variables.** These are secrets — a GitHub token, an admin
  password, a session-signing key. I do not handle credentials, even ones you paste to me.
  Generate them and enter them directly in the Netlify dashboard.
- **Buying the domain.** That is a purchase.
- **Pointing DNS.** It follows the purchase and depends on your registrar account.

Everything on the code side is done: `main` builds clean, the golden baseline matches, and
the branch contains the editor, the media library, and the publish split.

---

## Before you start

Two facts to have in front of you.

**The site is set to launch indexable.** `netlify.toml` sets `ROBOTS_ALLOW = "true"` in the
production context, so Google is allowed in from the first production deploy. That was a
deliberate choice. If you change your mind, set it to `"false"` and redeploy — that is the
whole switch, no other file changes.

**The phone number is not real yet.** `content.json` has `ct.phone` as "Not published yet",
and the page says exactly that. Since you are launching indexable, this is the first thing
worth fixing after the site is up: for a local business, a phone number is one of the
strongest signals Google has, and a parent deciding whether to trust a trainer will look
for it. You can fix it yourself in the admin panel once you are live.

---

## Step 1 — Create the Netlify site

1. app.netlify.com → **Add new project** → **Import an existing project** → GitHub.
2. Authorise Netlify for `shaver3josiah/fast-basketball-site` (private repo — it will ask).
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

Optional, only if you want the playbook emailed rather than just downloaded:
`RESEND_API_KEY` and `PLAYBOOK_FROM_EMAIL` (must be a verified sender in Resend).

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

The code has already settled on **`kingfastbasketball.com`**: it is the fallback in
`src/lib/site-config.mjs`, and every email address on the site is `@kingfastbasketball.com`.
Buy that one, or decide on a different one and change both places before you buy.

Once the domain resolves: add it in Netlify, let the certificate issue, then set `SITE_URL`
to `https://yourdomain.com` and redeploy so canonicals, the sitemap and the structured data
all agree.

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

## Still open, and none of it is code

Carried forward from `TIMELINE.md`, because launching does not close any of them:

- Miami/Broward training photography. Every proof image is a college gym. The design system
  calls this the launch blocker.
- A real phone number.
- Verified reviews, before the testimonials section can come back.
- Blake's exact role at RMU and Moberly.
- A cancellation policy, rather than `/terms` saying it is handled case by case.
- A Florida attorney reading `/privacy` and `/terms`. Both carry a visible note saying they
  were written in good faith by someone who is not a lawyer.
