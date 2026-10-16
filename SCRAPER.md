# USMS Scraper Documentation

CLI tool that scrapes US Masters Swimming (USMS) team records from usms.org and transforms them into JSON for Firebase/Firestore import.

## Setup

```bash
pip install hatch
hatch shell
```

## Commands

### Scrape Records

```bash
# Scrape all COLM records (SCY, SCM, LCM) for 2015-2025
hatch run scrape --team COLM --output ./data/csv

# Scrape specific years
hatch run scrape --team COLM --output ./data/csv --years 2020-2024

# Scrape only SCY
hatch run scrape --team COLM --output ./data/csv --courses SCY

# Adjust delay between requests (default: 2.0s)
hatch run scrape --team COLM --output ./data/csv --delay 3.0
```

### Update (Incremental)

Scrapes only the current year and diffs against existing data. Idempotent — running it twice with no new meets produces no changes.

```bash
# Check for new results, transform, and update website data
hatch run update --team COLM

# Also generate Firebase import format
hatch run update --team COLM --firebase
```

### Nationwide Crawl (Paced)

Crawls the local top-10 listings for **every LMSC and every club** in the USMS database
(2000 to the current year, SCY/SCM/LCM) and spreads the work evenly over a number of days
so usms.org is never hammered. Each invocation does one slice and checkpoints to
`data/usms/crawl_state.json`; re-running resumes where it left off.

```bash
# Start (or resume) a 15-day crawl; run this twice a day
hatch run crawl

# See progress and the budget the next run would use, without opening a browser
hatch run crawl -- --status

# Start over, or crawl just a few LMSCs / recent years
hatch run crawl -- --reset
hatch run crawl -- --reset --lmsc 55,13 --start-year 2020 --days 2

# Force a bigger/smaller slice, or cap wall-clock time (checkpoints and exits 0)
hatch run crawl -- --budget 500 --max-minutes 60
```

How it works:

1. **Phase 1 – LMSC listings.** One request per (LMSC, year, course) with the club field
   blank. The LMSC-wide top 10 is saved to
   `data/csv/usms/<lmscId>/lmsc_top10/<lmscId>_<course>_<year>_top10.csv` and every club
   code seen is recorded.
2. **Phase 2 – club listings.** One request per (LMSC, year, course, club) for each club
   seen in that LMSC within `--club-window` years (default 2) of the target year. The
   per-club rows are combined into
   `data/csv/usms/<lmscId>/<lmscId>_<course>_<year>_records.csv` (same columns as the
   team CSVs; `team` is the club code).

The per-run request budget is `remaining requests / runs left before the deadline`
(`--days` x `--runs-per-day`), so the crawl finishes on time whether runs are fast or slow.
`data/usms/clubs.json` summarises every club discovered per LMSC. A unit that fails three
times is skipped; five consecutive failures abort the run with exit code 2 (usms.org is
probably serving its WAF challenge). Pass `--debug-html` to keep the offending pages in
`data/csv/usms/debug/`.

The GitHub Actions workflow `.github/workflows/usms-crawl.yml` runs a slice at 03:00 and
15:00 UTC and commits the results. Use **Run workflow** with `reset=true` to start a new
crawl; once the state file is marked finished, scheduled runs are no-ops.

### Transform CSV to JSON

```bash
# Transform all CSVs in a directory
hatch run transform --input ./data/csv --output ./data/json --team COLM --combine

# Generate Firebase-specific format
hatch run transform --input ./data/csv --output ./data/json --team COLM --firebase

# Generate newline-delimited JSON (for streaming imports)
hatch run transform --input ./data/csv --output ./data/json --team COLM --ndjson
```

### All-in-One

```bash
hatch run all --team COLM --csv-output ./data/csv --json-output ./data/json --firebase
```

## Output Formats

### Standard JSON Array

```json
[
  {
    "id": "COLM_50_free_scy_men_25_29",
    "team": "COLM",
    "event": "50 Free",
    "course": "scy",
    "gender": "men",
    "ageGroup": "25-29",
    "time": "22.45",
    "timeInSeconds": 22.45,
    "swimmer": "John Doe",
    "date": "2024-03-15",
    "meet": "SC State Championships"
  }
]
```

### Firebase Import Format

```json
{
  "teamRecords": {
    "COLM_50_free_scy_men_25_29": {
      "id": "COLM_50_free_scy_men_25_29",
      "team": "COLM",
      ...
    }
  }
}
```

### NDJSON (Newline-Delimited JSON)

```
{"id": "COLM_50_free_scy_men_25_29", "team": "COLM", ...}
{"id": "COLM_50_free_scy_men_30_34", "team": "COLM", ...}
```

## CSV Format

If manually creating CSVs or getting them from another source:

```csv
team,event,course,gender,age_group,time,swimmer,date,meet
COLM,50 Free,SCY,M,25-29,22.45,John Doe,2024-03-15,SC State Championships
COLM,100 Free,SCY,W,30-34,58.12,Jane Smith,2024-03-15,SC State Championships
```

## Troubleshooting

The USMS website structure may change. If scraping fails:

1. Run with `--debug-html` to save raw HTML for inspection
2. Run with `--show-browser` to watch the browser interact with the site
3. Check URL patterns in `scraper.py` → `ScraperConfig`
4. Adjust parsing in `_parse_results()`

### Relevant USMS pages

- Top Times: https://www.usms.org/comp/meets/toptimes.php
- Individual Results: https://www.usms.org/comp/meets/indresults.php
- Meet Results: https://www.usms.org/comp/meets/meetlist.php

## Firebase Upload

After generating JSON, upload to Firestore:

```javascript
const admin = require('firebase-admin');
const records = require('./data/json/COLM_all_records.json');

const db = admin.firestore();
const batch = db.batch();

records.forEach(record => {
  const ref = db.collection('teamRecords').doc(record.id);
  batch.set(ref, record);
});

await batch.commit();
```
