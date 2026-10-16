# Masters Swim Club Sites

A multi-tenant website platform + data pipeline for US Masters Swimming clubs (first tenant: Columbia Masters, COLM). Each club gets a static site — records, schedule, events, coaches, gallery — built from one shared codebase and deployed on Cloudflare Pages.

## Architecture

```
USMS website → Scraper (Selenium) → CSV → Transformer → JSON ─┐
Google Sheet (per club: schedule/events/board/content) ───────┼→ Static site (Vite)
tenants/<slug>/ (identity, bios, classes, fallbacks, assets) ─┘
```

- **Tenants** live under `tenants/<slug>/` — `tenant.json` (identity, domain, Sheet ids), markdown content (about, coach bios, classes), JSON fallbacks, and the club's static assets in `public/`
- **Scraper** fetches team records from [usms.org](https://www.usms.org) across all courses (SCY, SCM, LCM), events, genders, and age groups
- **Web build** (`web/`, Vite) renders one club per build: `TENANT=<slug> npm run build` (defaults to `colm`). Each club is its own Cloudflare Pages project pointing at this repo with that env var.

## Quick Start

```bash
pip install hatch
hatch shell
```

## Keeping Data Up to Date

After clubs compete, refresh everything in one shot:

```bash
hatch run refresh                    # all clubs: scrape current year, rebuild data + indexes
hatch run refresh -- --tenant colm   # a single club
hatch run refresh -- --full          # re-scrape all years from each club's startYear
hatch run refresh -- --skip-scrape   # only rebuild JSON + gallery/locations indexes
```

Scraping is idempotent — CSVs are only rewritten when USMS shows new or changed records, and the transform/publish step is skipped when nothing changed. Then commit and push: every club's Pages project rebuilds from the same commit.

Single-club update (same behavior the refresh loop uses):

```bash
hatch run update -- --tenant colm
```

## Managing Website Content

The website pulls dynamic content from a published Google Sheet. Organizers can update the site without any code changes or rebuilds — just edit the spreadsheet and the site reflects changes on the next page load.

The Google Sheet has four tabs, plus two optional ones for FAQs and sample workouts:

| Tab | What it controls |
|-----|-----------------|
| **Events** | Upcoming meets and competitions |
| **Schedule** | Practice days, times, and pool type |
| **Board** | Board members and their roles |
| **Content** | Hero text, about section, alerts, and other copy |
| **FAQ** *(optional)* | Frequently asked questions, shown as an expandable list |
| **Workouts** *(optional)* | Sample practices shown on the `/workouts/` page |

### Adding the FAQ Tab

The FAQ section reads from an optional Sheet tab. Until a club adds one, the site shows the static fallback in `tenants/<slug>/content/fallback/faq.json` instead. To wire up the live Sheet version:

1. In the club's Google Sheet, add a new tab named **FAQ** with a header row: `question`, `answer` (one question per row; `answer` supports basic markdown like links and bold text).
2. Re-publish the sheet to the web if it isn't already published in full (File → Share → Publish to web).
3. Open the FAQ tab and copy its `gid` from the browser URL (the number after `gid=`).
4. Add that value to the tenant's `tenant.json` under `sheet.gids.faq`, e.g.:
   ```json
   "gids": { "events": 0, "schedule": 169167840, "board": 1134517228, "content": 439056656, "faq": 123456789 }
   ```
5. Commit and push — once deployed, the FAQ section pulls live from the Sheet and updates on every page load, no rebuild needed. The static fallback keeps working as a backup if the Sheet is ever unreachable.

### Adding the Workouts Tab

The `/workouts/` sample-workouts page (`tenants/<slug>/public/workouts/index.html`) is a standalone static page — it isn't part of the Vite build, so it can't read `tenant.json` at build time. Instead it fetches an optional **Workouts** Sheet tab directly at runtime, with the same published spreadsheet used everywhere else. Until that tab is wired up, the page shows the static workouts baked into the HTML.

Sheet schema — one row per set line, flat columns: `workout`, `bestFor`, `section`, `distance`, `details`, `rest`.

- `workout` — the workout's title (e.g. `1. Aerobic Endurance`), repeated on every row belonging to it.
- `bestFor` — short phrase shown next to "Best for:" in the header, also repeated per row.
- `section` — one of `Warm-Up`, `Pre-Set`, `Main Set`, `Cool-Down` for a normal set row, or the special values `Note` (a callout shown after the Main Set table) or `Total` (the yardage breakdown shown at the end — the page extracts the trailing `= 2,800 yd` into the compact header total automatically).
- `distance`, `details`, `rest` — the three table columns for normal rows; leave `distance`/`rest` blank for `Note`/`Total` rows.

To wire it up:

1. Add a new tab named **Workouts** to the club's Google Sheet with that header row, then add your rows (workouts can be added, removed, or reordered freely — the page renders whatever's there, in row order).
2. Re-publish to the web if needed (File → Share → Publish to web).
3. Open the Workouts tab and copy its `gid` from the browser URL.
4. In `tenants/<slug>/public/workouts/index.html`, find the `SHEET_GID` constant near the bottom of the file and set it to that number (it starts as `null`, meaning "no tab yet, show the static fallback").
5. Commit and push. The static markup in `#workouts-container` stays in the file as a fallback if the Sheet is ever unreachable — no need to remove it.

### Publishing an Alert (e.g., Pool Closure)

To display a site-wide alert banner (pool closed, schedule change, etc.):

1. Open the **Content** tab in the Google Sheet
2. Add or edit a row with `key` = `alert_message`
3. Set `value` to the message (e.g., "Pool is closed today for maintenance")
4. The red banner appears at the top of the site on the next page load

To remove the alert, clear the `value` cell for `alert_message`.

### Content Keys Reference

| Key | Where it appears |
|-----|-----------------|
| `hero_sub` | Subtitle under the team name |
| `hero_tagline` | Tagline below the subtitle |
| `about_text` | First paragraph of the About section |
| `about_text_2` | Second paragraph |
| `about_text_3` | Third paragraph |
| `schedule_note` | Note displayed below the schedule grid |
| `alert_message` | Site-wide alert banner (red bar at top) |

## Editing the Site (Page Editor)

Club web admins can rearrange the home page, add content blocks, and create new pages at **`/admin/`** without touching code. The Google Sheet still owns the schedule, events, board, FAQ and site copy. The editor controls the *layout*: which sections appear, in what order, and any extra pages.

- **Built-in sections** (Hero, About, Schedule, …): drag to reorder or hide them. Their content still comes from the Sheet.
- **Blocks**: Heading, Text (markdown), Image (uploads are resized in the browser), Buttons, Callout, Embed (YouTube, Google Maps/Forms/Calendar) and Divider.
- **Pages**: each new page lives at `/<address>/` and can appear in the site menu. It is listed in the sitemap and `llms.txt` automatically.
- Drafts autosave in the admin's browser. **Publish** commits `tenants/<slug>/content/pages/*.json` (and any new images under `public/uploads/`) to `main` as one commit, with an `Edited-by:` trailer. Cloudflare Pages then rebuilds, and the change is live in about 2 minutes. To roll back, revert the commit.
- If two admins publish at the same time, the second one is told and can either load the latest version or publish over it.

**Local:** `cd web && TENANT=colm npm run dev`, then open http://localhost:5173/admin/. In dev, Publish writes the tenant files directly; nothing is committed.

### Choosing a design

Every club can choose a site template in the editor, much like picking a theme in Word. Click **Design** in the editor's top bar. Hover over a design to preview it on the page, pick an accent color (or a custom one), then click **Apply design** and **Publish**.

| Design | Look |
|--------|------|
| **Lane Line** (default) | Classic navy and gold, clean cards, centered headings |
| **Deep End** | Dark and athletic, huge condensed headlines, bright accent |
| **Morning Swim** | Bright and rounded, friendly type, a sunny lane-tile hero |

- The choice is saved in `tenants/<slug>/content/site.json`, for example `{ "theme": "morning-swim", "accent": "#ffd166" }`. If the file is missing, the club gets Lane Line with its `tenant.json` colors. A bad value fails the build, so the last good deploy stays live.
- Designs change only CSS and fonts. The content, Sheet overrides and element ids are the same in every design.
- A chosen accent is applied to `<html>`, so it takes priority over `colors.accent` in `tenant.json`.
- **Preview without publishing:** add `?theme=<id>&accent=%23rrggbb` to any page URL, for example `/?theme=deep-end`. The **Preview full site** link in the Design gallery opens one. The design switches in the browser, and nothing is saved. On the dev server, a floating **Design** switcher in the corner changes it live.
- To add a design:
  1. Add an entry to `THEMES` in `web/shared/site.ts`.
  2. Create `web/src/themes/<id>.css`, with every rule scoped under `[data-theme="<id>"]`. The token block must use `:root[data-theme="<id>"], [data-theme="<id>"]`.
- The standalone `/workouts/` page is a static file outside the build, so it keeps the default look.

### One-time setup per club (Cloudflare dashboard)

1. **Access application.** Go to Zero Trust → Access → Applications → *Self-hosted*. Add these hostnames/paths:
   - `<club-domain>/admin*`
   - `<club-domain>/api/admin/*`
   - the same two paths on `<project>.pages.dev` and `*.<project>.pages.dev` (previews)

   Add an *Allow* policy listing the admins' emails, and copy the application's **AUD tag**.
2. **GitHub token.** Create a fine-grained personal access token with access to this repository only and the **Contents: Read and write** permission.
3. **Pages environment variables.** In the Pages project → Settings → Variables and Secrets, for Production:
   | Name | Value |
   |------|-------|
   | `TENANT` | club slug (already set for the build) |
   | `GITHUB_TOKEN` | the token from step 2 (type: *Secret*) |
   | `GITHUB_REPO` | `owner/repo`, e.g. `cdrake/columbia-masters` |
   | `GITHUB_BRANCH` | optional, defaults to `main` |
   | `ACCESS_TEAM_DOMAIN` | your Zero Trust team name, e.g. `myteam` (from `myteam.cloudflareaccess.com`) |
   | `ACCESS_AUD` | the AUD tag from step 1 |
4. Redeploy. Until every variable is set, `/api/admin/*` returns "isn't set up yet". The API also re-checks the Access login on every request, so it stays closed even if step 1 is incomplete.
5. *(Optional, multi-club)* Set **Build watch paths** to `web/*` and `tenants/<slug>/*`, so an edit to one club doesn't rebuild every other club.

> Admin edits land on `main`. Run `git pull` before pushing local `hatch run refresh` commits.

## Scraper Documentation

For full scraper usage, data formats, and troubleshooting, see [SCRAPER.md](SCRAPER.md).

## License

MIT
