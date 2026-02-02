# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Python CLI tool that scrapes US Masters Swimming (USMS) team records from usms.org and transforms them into JSON for Firebase/Firestore import. Uses hatch for project management.

## Commands

```bash
# Enter dev environment
hatch shell

# Run scraper
hatch run scrape --team COLM --output ./data/csv
hatch run transform --input ./data/csv --output ./data/json --team COLM --firebase
hatch run all --team COLM --csv-output ./data/csv --json-output ./data/json

# Run directly
python -m usms_scraper.cli scrape --team COLM

# Lint
ruff check src/
ruff format src/

# Test
pytest
```

## Architecture

The pipeline is: **scrape HTML → CSV → transform → JSON (for Firebase)**.

- `src/usms_scraper/cli.py` — argparse CLI with three subcommands: `scrape`, `transform`, `all`
- `src/usms_scraper/scraper.py` — `USMSScraper` class fetches USMS top-times pages via requests+BeautifulSoup, filters by team code, writes CSV. `ScraperConfig` holds URL patterns and parameters that may need updating if the USMS site changes.
- `src/usms_scraper/transformer.py` — Reads CSVs, creates `TeamRecord` objects, outputs JSON in three formats: array, Firebase keyed-by-ID, and NDJSON.
- `src/usms_scraper/models.py` — `TeamRecord` dataclass with `to_dict()` that converts snake_case fields to camelCase for Firebase. Contains normalization helpers for time strings, event names, course codes, and gender values.

## Key Details

- Record IDs are deterministic: `{team}_{event}_{course}_{gender}_{ageGroup}` (see `TeamRecord.id`)
- The scraper iterates over all combinations of course (SCY/SCM/LCM) × event × gender, with a configurable delay between requests
- USMS HTML parsing in `_parse_results_table()` is generic and may need adjustment when the site structure changes — check `ScraperConfig` URL patterns first
- Ruff config: line-length 100, target Python 3.10
