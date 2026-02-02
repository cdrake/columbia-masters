# USMS Team Records Scraper

Scrape team records from the US Masters Swimming website and transform them to JSON for Firebase.

## Setup

```bash
# Install hatch if you don't have it
pip install hatch

# Create and activate environment
cd usms-scraper
hatch shell

# Or run directly with hatch
hatch run scrape --team COLM
```

## Usage

### Scrape Records

```bash
# Scrape all COLM records (SCY, SCM, LCM)
hatch run scrape --team COLM --output ./data/csv

# Include relay events
hatch run scrape --team COLM --output ./data/csv --relays

# Adjust delay between requests (be nice to the server)
hatch run scrape --team COLM --delay 2.0
```

### Transform CSV to JSON

```bash
# Transform a single CSV
hatch run transform --input ./data/csv/COLM_scy_records.csv --output ./data/json --team COLM

# Transform all CSVs in a directory
hatch run transform --input ./data/csv --output ./data/json --team COLM --combine

# Generate Firebase-specific format
hatch run transform --input ./data/csv --output ./data/json --team COLM --firebase

# Generate newline-delimited JSON (for streaming imports)
hatch run transform --input ./data/csv --output ./data/json --team COLM --ndjson
```

### All-in-One

```bash
# Scrape and transform in one step
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

If you're manually creating CSVs or getting them from another source, use this format:

```csv
team,event,course,gender,age_group,time,swimmer,date,meet
COLM,50 Free,SCY,M,25-29,22.45,John Doe,2024-03-15,SC State Championships
COLM,100 Free,SCY,W,30-34,58.12,Jane Smith,2024-03-15,SC State Championships
```

## Customizing the Scraper

The USMS website structure may change. If scraping fails, you may need to:

1. Inspect the actual HTML structure at usms.org
2. Update URL patterns in `scraper.py` → `ScraperConfig`
3. Adjust table parsing in `_parse_results_table()`

### Finding the Right URLs

Check these USMS pages:
- Top Times: https://www.usms.org/comp/meets/toptimes.php
- Individual Results: https://www.usms.org/comp/meets/indresults.php
- Meet Results: https://www.usms.org/comp/meets/meetlist.php

Use browser dev tools to see how forms submit and what parameters are used.

## Firebase Upload

After generating JSON, upload to Firestore:

```javascript
// Using Firebase Admin SDK
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

Or use the Firebase CLI:

```bash
firebase firestore:delete teamRecords --recursive  # Clear existing
# Then import using a script or the console
```

## License

MIT
