# New Club Onboarding Checklist

How to launch a new club site at `https://<slug>.swimclubs.org`, with no domain purchase needed. Budget about an hour. Most of that time goes into gathering the club's content.

Throughout, `<slug>` is the club's lowercase team code, for example `colm`. It is used for the tenant folder, the Pages project env var and the subdomain.

## 0. Collect from the club

- [ ] **USMS identity:** team code (e.g. `COLM`), LMSC name and number. Look up the LMSC number (the `lmscId`) by name in the `LMSCS` table in `src/usms_scraper/crawl.py`.
- [ ] **Basics:** club name, short name, one-sentence description, home pool name and street address.
- [ ] **Hero text:** a short subtitle and a tagline.
- [ ] **About:** an "About" paragraph or two, and a schedule note (membership or day-pass rules).
- [ ] **Links:** social links, plus any documents (e.g. bylaws as a PDF).
- [ ] **Coaches:** name, photo and short bio for each coach (optional).
- [ ] **Branding:** a logo or icon for the favicons, if the club has one.
- [ ] **Editors:** the email address of each person who will edit the site. Keep the list short: see [Free-tier limits](#free-tier-limits).
- [ ] **Records:** the first year the club's records should go back to (`records.startYear`).

## 1. Google Sheet (club content)

- [ ] Make a copy of the COLM Sheet: File → Make a copy. Share it with the club's organizers.
- [ ] Clear COLM's rows. Keep the tab names and column headers exactly as they are: Events, Schedule, Board, Content, and optionally FAQ and Workouts.
- [ ] File → Share → **Publish to web** → Entire document → Publish.
- [ ] Note two things for `tenant.json`:
  - the **published ID**, the `2PACX-…` part of the published URL
  - each tab's **gid**, the `#gid=` number in the editor URL when that tab is open

## 2. Tenant files (repo)

- [ ] Copy `tenants/colm/` to `tenants/<slug>/`. Then delete the copied COLM data:
  - `public/data/`, `public/gallery/`, `public/locations/`
  - coach photos and `bylaws.pdf`
- [ ] Edit `tenants/<slug>/tenant.json`:
  - `slug`, `teamCode`, `lmscId`, `lmscName`, `name`, `shortName`, `description`, `hero`, `pool`, `address`, `scheduleNote`, `socials`, `documents`
  - `"domain": "https://<slug>.swimclubs.org"`. This is used for canonical URLs, the sitemap and `llms.txt`. If the club buys its own domain later, change it there.
  - `sheet.publishedId` and `sheet.gids` from step 1. Leave out `faq` if the club has no FAQ tab.
  - `records.startYear`
  - `colors`: leave this as `{}` to use the theme default.
- [ ] Rewrite the content:
  - `content/about.md`
  - `content/coaches/*.md` (frontmatter: `name`, `photo`)
  - `content/classes/*.md`, or delete it
  - `content/fallback/*.json`: don't edit these by hand. Run `hatch run sync-content -- --tenant <slug>` once the Sheet is published; it snapshots the Sheet into them (the daily **Sheet content sync** workflow keeps them current)
  - optional `"timeZone"` in `tenant.json` if the club isn't on Eastern time (e.g. `"America/Chicago"`)
- [ ] `content/pages/home.json`: keep the COLM copy. The club can rearrange it in the editor later.
- [ ] `content/site.json`: delete it to start on Lane Line, or set `{ "theme": "<id>" }`.
- [ ] Replace the favicons and icons in `public/`.
- [ ] Load the club's records:
  ```bash
  hatch run refresh -- --tenant <slug> --full
  cd web && TENANT=<slug> npm run build     # must pass
  TENANT=<slug> npm run dev                 # eyeball it at http://localhost:5173/
  ```
- [ ] Commit and push to `main`. Admin commits also land on `main`, so pull first.

## 3. Cloudflare Pages project

All of these steps are in the Cloudflare dashboard (account christopher.a.drake@gmail.com).

- [ ] Workers & Pages → Create → Pages → **Connect to Git** → `cdrake/columbia-masters`, with these settings:
  - Project name: `<slug>-masters`, or any name. It becomes `<project>.pages.dev`.
  - Production branch: `main`
  - Build command: `npm run build`
  - Build output: `dist`
  - Root directory: `web`
- [ ] Build env var: `TENANT` = `<slug>`. Set this before the first deploy.
- [ ] Settings → Build → **Build watch paths** → Include `web/*` and `tenants/<slug>/*`. **This step is required.** Without it, every commit (including the twice-daily crawl commits) rebuilds every club. See [Free-tier limits](#free-tier-limits).
- [ ] Wait for the first deploy, then check that `https://<project>.pages.dev/` loads. The club is now live on a free address.
- [ ] **Custom domains** → Set up a custom domain → `<slug>.swimclubs.org` → **Activate domain**.
  - Cloudflare creates the CNAME automatically, because `swimclubs.org` is in the same account.
  - The SSL certificate takes a few minutes.

## 4. Site editor login (Cloudflare Access)

Give each club **its own** Access application. One wildcard app for every club would let any club's editors edit every other club.

- [ ] Zero Trust → Access controls → Applications → **Create new application** → Self-hosted, named "`<SHORTNAME>` site editor". Add these public hostnames:

  | Subdomain | Domain | Path |
  |---|---|---|
  | `<slug>` | `swimclubs.org` | `admin*` |
  | `<slug>` | `swimclubs.org` | `api/admin/*` |
  | *(none)* | `<project>.pages.dev` | `admin*` |
  | *(none)* | `<project>.pages.dev` | `api/admin/*` |
  | `*` | `<project>.pages.dev` | `admin*` |
  | `*` | `<project>.pages.dev` | `api/admin/*` |

- [ ] Policy: **Allow**, Include → Emails → the club's editors. Set the session duration to 24h.
- [ ] Login method: One-time PIN, the default. Editors get a code by email, and no accounts are needed.
- [ ] Save, then copy the application's **AUD tag** from Basic information.

## 5. Editor environment variables

In the Pages project → Settings → **Variables and secrets** (Production). The dashboard sometimes drops unsaved rows, so confirm that all five appear in the list after you click **Save**.

| Type | Name | Value |
|---|---|---|
| Text | `TENANT` | `<slug>` (already set in step 3) |
| Text | `GITHUB_REPO` | `cdrake/columbia-masters` |
| Text | `ACCESS_TEAM_DOMAIN` | `swimclubs` |
| Text | `ACCESS_AUD` | the AUD tag from step 4 |
| **Secret** | `GITHUB_TOKEN` | a fine-grained GitHub token: repo `cdrake/columbia-masters` only, **Contents: Read and write**, 365-day expiry (the maximum). Every club's project can use the same token. |

- [ ] Deployments → ⋯ on the latest deploy → **Retry deployment**. Env vars only apply to new deploys.

> **Renewing the token:** GitHub's **Regenerate token** resets the expiration to 30 days. Set it back to **Custom** (one year out) before regenerating. Then update `GITHUB_TOKEN` in every club's Pages project and retry each deployment. If the token is wrong or expired, `/admin/` shows "Can't open the editor (502)".

## 6. Verify

- [ ] The new club's site loads over HTTPS: `curl -sI https://<slug>.swimclubs.org/` returns `200`.
- [ ] Logged out, `https://<slug>.swimclubs.org/admin/` redirects to `swimclubs.cloudflareaccess.com`.
- [ ] Signed in as an editor, `/admin/` shows "Everything is published". If it says "site editor isn't set up", a variable from step 5 is missing.
- [ ] Records show on the site, and the Sheet tabs populate.
- [ ] `https://<slug>.swimclubs.org/llms.txt` shows the club's current schedule, and `/api/content?section=schedule` returns `"source":"sheet"`.
- [ ] Send the editors the URL `https://<slug>.swimclubs.org/admin/` and the README section "Editing the Site".

## Free-tier limits

These are the limits that actually bind as the number of clubs grows:

| Limit | Free allowance | How we stay under it |
|---|---|---|
| Zero Trust seats | 50 users, shared across **all** clubs | Only list real editors (2–3 per club). "Remove inactive users from seats" is set to 1 month. Check the seat count under Zero Trust → Settings. |
| Pages builds | 500 per month, account-wide | Build watch paths (step 3). Crawl and refresh commits only rebuild the clubs whose files changed. |
| Pages custom domains | 100 per project | One or two per club. |
| Functions (admin, records, content API and `/llms.txt`) | 100k requests per day, account-wide | Only those routes run Functions; page views are static. Sheet reads are cached 5 minutes. Never add a root `functions/_middleware.ts`. |
| `swimclubs.org` | about $11.20 per year, auto-renew on | This is the only recurring cost. Every club subdomain depends on it. |

Don't enable any paid Zero Trust add-ons (Browser Isolation, DLP, CASB), and don't roll out the WARP client.

## Later: the club buys its own domain

1. Add the domain to Cloudflare. Either transfer it or point its nameservers at Cloudflare.
2. Add the apex and `www` domains under the Pages project's **Custom domains**.
3. Add both hostnames (with `admin*` and `api/admin/*`) to the club's Access application.
4. Change `domain` in `tenant.json`, then commit.
5. Keep `<slug>.swimclubs.org` attached so old links keep working.
