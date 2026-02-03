# COLM Team Portal

A website and data pipeline for the Columbia Masters (COLM) swim team. The site serves as a team portal featuring swimming records, swimmer profiles, meet schedules, and news — powered by data scraped from US Masters Swimming (USMS) and stored in Firebase.

## Architecture

```
USMS website → Scraper (Selenium) → CSV → Transformer → JSON → Firebase/Firestore → Website
```

- **Scraper** fetches team records from [usms.org](https://www.usms.org) across all courses (SCY, SCM, LCM), events, genders, and age groups
- **Transformer** converts CSV data to JSON with deterministic record IDs for Firebase upserts
- **Website** reads from Firestore to display team records and information

## Quick Start

```bash
pip install hatch
hatch shell
```

## Keeping Data Up to Date

After the team competes in a meet, run the update command to pull in new results:

```bash
hatch run update --team COLM --output ./data/csv
```

This scrapes the current year from USMS, diffs against existing data, and only writes CSVs when new or changed records are found. To also regenerate JSON for Firebase:

```bash
hatch run update --team COLM --output ./data/csv --transform --firebase --json-output ./data/json
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
