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
