# Running and deploying the site

The site left Netlify in September 2026. It now runs on **Firebase Hosting** in the project
`fast-basketball-b3ebe`, the same project the coach app already uses. The domain
`fast-basketball.com` stays registered at **Wix**, and Wix stays the DNS host. Those are two
different jobs: Wix answers "what is the address of this domain", Firebase answers "here is
the website". Wix cannot host this site itself, because it is a custom build with thirteen
server endpoints, and Wix runs neither.

## What moved

| Piece | Netlify | Now |
| --- | --- | --- |
| Static pages | Netlify CDN | Firebase Hosting, serving `dist/` |
| Server endpoints | 12 functions under `/.netlify/functions/` | one Cloud Function behind `/api/**` |
| Key/value store | Netlify Blobs | Firestore, via `server/functions/lib/blobs.mjs` |
| Staged photos | Netlify Blobs | Cloud Storage (8MB uploads do not fit a Firestore document) |
| Contact + playbook forms | Netlify Forms, no code | `/api/contact` and `/api/playbook` |
| Headers and redirects | `netlify.toml` | `firebase.json` |
| Rebuild on push | automatic | `.github/workflows/deploy.yml` |

The handler code itself barely changed. Netlify passed each handler a Web `Request` and took
back a `Response`; `functions/index.mjs` translates Cloud Functions' Express objects into the
same pair, so nothing in `server/functions/` knows which host it is on.

## Local development

Unchanged, and it needs no Firebase account, no emulator and no network:

```bash
npm run dev
```

`http://localhost:8899` serves the site, the admin panel and `/api/*` from the same handler
files production runs. `FB_LOCAL=true` sends every write to a gitignored JSON file under
`.local/` instead of Firestore, which is why a laptop needs no credentials.

## One-time setup before the first deploy

1. **Upgrade the project to the Blaze plan.** Cloud Functions requires it. Blaze includes
   2,000,000 free invocations a month, so a site this size bills nothing; a card is required
   anyway. Firebase console → the project → Usage and billing.
2. **Create the Firestore database** if it does not exist, in Native mode. Only the Admin SDK
   touches it, and the Admin SDK bypasses security rules, so no rules change is needed.
3. **Enable Cloud Storage** if Blake will upload photos through the admin panel. Skip it and
   everything else still works; only the media library fails.
4. **Fill in `functions/.env`** from `functions/.env.example`.
5. **Deploy:**

```bash
npm run deploy
```

That builds `dist/`, copies the server into `functions/` and pushes Hosting and the function.
The site is then live at `https://fast-basketball-b3ebe.web.app`.

> **Never run a bare `firebase deploy` from this directory.** The npm scripts always pass
> `--only`. `firebase.json` here deliberately has no `firestore` block, so a deploy from here
> cannot overwrite the coach app's security rules, which live in `fast-basketball-app/` and
> carry Blake's real Auth uid.

## Pointing fast-basketball.com at it, with DNS staying at Wix

1. Firebase console → Hosting → **Add custom domain** → `fast-basketball.com`.
2. Firebase gives a **TXT record** to prove ownership. In the Wix dashboard, open
   **Domains → fast-basketball.com → DNS records**, add that TXT record, and wait for
   Firebase to verify.
3. Firebase then gives **two A records** (plain IPv4 addresses). Add both at the root of the
   domain in the same Wix DNS panel. A records are the reason this is on Firebase rather than
   Cloudflare Pages: a root domain cannot use a CNAME, and Firebase publishes real addresses
   while Cloudflare Pages expects you to move nameservers.
4. Repeat for `www.fast-basketball.com` if you want it, which Firebase handles with a CNAME.
5. If the domain is currently connected to a Wix site, disconnect it there first, or Wix will
   keep serving its own page from those records.
6. Certificates are issued automatically and take up to 24 hours.
7. **The last step, and it is easy to forget:** in GitHub → the repo → Settings → Secrets and
   variables → Actions → Variables, set `SITE_URL` to `https://fast-basketball.com`, then push
   anything. Until you do, every canonical URL, the sitemap and the structured data still name
   the `web.app` address.

## Publishing content

Blake edits at `/admin` and presses Publish. That commits to GitHub through the API, and
`.github/workflows/deploy.yml` builds and deploys Hosting on the push. Netlify used to watch
the repo itself; Firebase does not, so **that workflow is what makes the Publish button work.**

It needs one repository secret, `FIREBASE_SERVICE_ACCOUNT`, holding the JSON key of a service
account with the Firebase Hosting Admin role. The quickest way to create it:

```bash
npx firebase-tools init hosting:github
```

Answer the repo as `shaver3josiah/fast-basketball-site`, decline its offer to overwrite the
existing workflow file, and let it create the secret.

## Everyday commands

| Command | What it does |
| --- | --- |
| `npm run dev` | The whole site and API on `localhost:8899`. No cloud anything. |
| `npm run deploy` | Build, then deploy Hosting and the function. |
| `npm run deploy:hosting` | Content and pages only. What CI runs. |
| `npm run deploy:functions` | Server code only. Rare. |
| `npm run emulate` | Hosting, the function and Firestore locally. Needs a JDK 21+. |
| `npm test` | 45 tests. CI runs this before every deploy. |

## Checking a change before it goes live

```bash
npx firebase-tools hosting:channel:deploy check --expires 7d
```

That publishes `dist/` to a throwaway URL that is noindexed, expires by itself and never
touches the live site. Prefer it to the Hosting emulator, which on this machine applies no
headers and no redirects at all: current firebase-tools wants a JDK 21 where only 17 is
installed, and the hosting emulator's bundled server refuses Node 24. A minimal textbook
config fails there too, so a redirect that 404s in the emulator is not evidence of a problem.

## Stripe

Still not synced. `npm run stripe:catalog` with Blake's live key creates the prices, and until
it runs, `/enroll` saves the registration, emails Blake and tells the family he will send a
payment link. The webhook endpoint to register in the Stripe dashboard is now
`https://fast-basketball.com/api/stripe-webhook` (or the `web.app` address until DNS moves).
