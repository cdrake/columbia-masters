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

The Google Sheet has four tabs:

| Tab | What it controls |
|-----|-----------------|
| **Events** | Upcoming meets and competitions |
| **Schedule** | Practice days, times, and pool type |
| **Board** | Board members and their roles |
| **Content** | Hero text, about section, alerts, and other copy |

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
