# Migration Plan: GitHub Pages → Cloudflare Pages

Move the COLM site (columbiamastersswim.org) from GitHub Pages to Cloudflare Pages.
GitHub stays the source of truth; we only change where the site is built and served.
This sets up the hosting model we will reuse for multiple club domains later.

## Why we're doing this

- Free tier allows up to 100 custom domains per project, with free auto-SSL on each.
- No bandwidth metering (matters once club photo galleries are in play).
- Clean apex-domain handling via CNAME flattening.
- Same build, same repo, so this is low-risk and reversible.

## What's already verified (no action needed)

A clean install and production build were tested successfully. Confirmed Cloudflare settings:

| Setting | Value |
|---|---|
| Framework preset | Vite |
| Root (project) directory | `web` |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Vite `base` | `/` (already correct for a root custom domain) |

Build output includes `index.html`, hashed `assets/`, and the static `data/`, `gallery/`,
`classes/`, and `locations/` folders, matching what GitHub Pages serves today.

## Prerequisites (you)

- A Cloudflare account (free). Do not share credentials with anyone; create and sign in yourself.
- Access to the GitHub repo to authorize Cloudflare's GitHub app.
- Access to wherever DNS for columbiamastersswim.org is managed (registrar or current DNS host).

## Step-by-step

### 1. Record current DNS (rollback safety) — DONE 2026-07-08
Snapshot of live records (nameservers: Google Cloud DNS, `ns-cloud-c*.googledomains.com`).
This is the rollback target — restore these to point back at GitHub Pages:

```
www.columbiamastersswim.org.  CNAME  cdrake.github.io.
columbiamastersswim.org.      A      185.199.108.153
columbiamastersswim.org.      A      185.199.109.153
columbiamastersswim.org.      A      185.199.110.153
columbiamastersswim.org.      A      185.199.111.153
columbiamastersswim.org.      TXT    "v=spf1 -all"
columbiamastersswim.org.      TXT    "google-site-verification=9OBq5HRrccwbAX2CafP7G2X3Nt6A1i_wqyJc4RakSz4"
```

No MX or AAAA records exist. If moving nameservers to Cloudflare (step 4), re-create the two
TXT records there so SPF and Google site verification are preserved.

### 2. Create the Cloudflare Pages project — DONE 2026-07-08
Project **columbia-masters**, connected to GitHub repo `cdrake/columbia-masters`, branch `main`.
- Framework preset: **None** (the current dashboard has no plain "Vite" preset — only
  VitePress/Vue — so build settings were entered manually; identical result)
- Root directory: `web`, build command: `npm run build`, output directory: `dist`
- First build succeeded on commit 07edc02; 78 files uploaded.

### 3. Verify on the temporary URL (before touching DNS) — DONE 2026-07-08
Live at **https://columbia-masters.pages.dev**. Verified:
- Home page over HTTPS; alert banner, practice schedule, and events all render from the
  live Google Sheet (Columbia College schedule shown, not the baked-in Drew fallback).
- Records table loads with full data; `/data/*.json` serve.
- `/classes/`, `/locations/`, `/coaches/`, gallery pages and gallery images all return 200.

### 4. Add the domain to Cloudflare (nameserver route) — DONE 2026-07-08
Decision: move nameservers from Google Cloud DNS to Cloudflare (recommended path).

Done so far:
- Zone `columbiamastersswim.org` added to the Cloudflare account (Free plan).
- DNS records auto-imported and verified against live DNS: 4 apex A (GitHub Pages, proxied),
  `www` CNAME → `cdrake.github.io` (proxied), TXT SPF, TXT google-site-verification, plus
  `_dmarc` (reject) and `_domainkey` (empty DKIM) TXT records the original snapshot missed —
  all confirmed live and preserved.
- "Block AI training in robots.txt" was toggled OFF so Cloudflare doesn't rewrite the
  site's robots.txt (migration stays behavior-identical; can enable later).
- Assigned Cloudflare nameservers: **joaquin.ns.cloudflare.com** and **luciane.ns.cloudflare.com**.

Completed:
1. Nameservers replaced at Squarespace Domains (registrar; absorbed Google Domains) at
   11:04 AM — `.org` registry delegation flipped to Cloudflare ~4 minutes later.
2. Zone went **Active** in Cloudflare shortly after (used "Check nameservers now").
   Zero downtime — imported records kept serving GitHub Pages through the proxy.
3. Custom domains attached to the Pages project: `www` CNAME switched from
   `cdrake.github.io` to `columbia-masters.pages.dev`; apex's four GitHub A records
   replaced with a flattened CNAME to the same target.

### 5. DNS cutover — DONE 2026-07-08
Both hostnames confirmed serving from Cloudflare Pages (`server: cloudflare`, valid TLS,
no `x-github-request-id`). Note: the apex now serves the site directly (200) instead of
GitHub's old 301-to-www redirect.

### 6. Verify the live site — DONE 2026-07-08
Verified against the Cloudflare edge (local resolver caches lag for up to the old TTL):
- Home page title correct over HTTPS on both `www` and apex.
- `/data/*.json`, `/classes/`, `/locations/`, `/coaches/`, `/sitemap.xml`, gallery images
  all 200.
- `robots.txt` served byte-identical to the repo copy (no Cloudflare rewriting).
- Sheet-driven content (alert banner, schedule, events) was verified on the same build at
  `columbia-masters.pages.dev` in step 3.

### 7. Decommission GitHub Pages (only after you're confident) — TODO
- Give it a day or two of confidence on Cloudflare first. GitHub Pages still serving is
  harmless (and is what stale DNS caches hit during propagation).
- Then disable the Pages deploy so the two don't compete: either turn off GitHub Pages
  in repo Settings, or remove/disable `.github/workflows/deploy.yml`.
- Keep it disabled rather than deleted for a while, in case of rollback.

## Rollback
If the live site misbehaves after cutover, restore the DNS records you saved in step 1
(point `www` and apex back to GitHub Pages). GitHub Pages still has the last good build,
so traffic returns to the previous host as DNS propagates.

## Notes
- `web/CNAME` is a GitHub Pages mechanism and is ignored by Cloudflare. It's harmless to leave;
  remove it later if you want to avoid confusion.
- The site's pages are real static paths (not client-side SPA routes), so no SPA fallback config
  is needed. If we later add client-side routing, add a Cloudflare `_redirects` rule to serve
  `index.html` for unknown paths.
- Records currently come from JSON in `web/public/data`. Hosting and the records source are
  independent, so this migration doesn't change how records are produced.

## Forward link to multi-tenancy
This same Pages project is where additional club domains will later be attached. Each new club
becomes: one registry entry (hostname → slug → Sheet ID, Drive folder, records source) plus one
custom domain added here. No new project or deploy per club.
