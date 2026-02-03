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

## Scraper Documentation

For full scraper usage, data formats, and troubleshooting, see [SCRAPER.md](SCRAPER.md).

## License

MIT
