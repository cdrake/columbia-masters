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

## Scraper Documentation

For full scraper usage, data formats, and troubleshooting, see [SCRAPER.md](SCRAPER.md).

## License

MIT
