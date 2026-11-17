# SwimJSON ingest (experimental)

Branch: `experimental/swimjson-ingest`. Not wired into `refresh` or any workflow.

## Why

USMS put meet results behind a login on Nov 10, 2026, so the records crawl can't run. Meet hosts
already have the official results as Hy-Tek (HY3/CL2) or Lenex files. [SwimJSON](https://swimjson.org)
(by OpenLane, tryopenlane.com) is a proposed open JSON format for meet data, and its converter
turns HY3 and Lenex files into SwimJSON. If we read SwimJSON, club and state records can be updated
from the meet files themselves, with no USMS scraping.

```
Meet Manager (HY3/CL2) or Lenex ──swimjson.org converter──> SwimJSON
SwimJSON ──hatch run ingest-swimjson──> data/csv/... (same CSVs the crawl writes) ──publish──> site
```

## Usage

```bash
# A club: merges that club's swims into data/csv/<slug>/<TEAM>_<course>_<season>_records.csv
hatch run ingest-swimjson -- meet.swimjson.json --tenant colm --dry-run
hatch run ingest-swimjson -- meet.swimjson.json --tenant colm
hatch run publish -- --tenant colm

# A state site: swims by the clubs in tenant.json `clubs` go into the crawl's per-club CSVs
# (data/csv/usms/<lmsc>/) and the state top 10 (data/csv/usms/<lmsc>/lmsc_top10/)
hatch run ingest-swimjson -- meet.swimjson.json --tenant sc
hatch run refresh -- --tenant sc --skip-scrape
```

Ingest is idempotent: the same swim seen twice (from the crawl, or a file ingested again) is
dropped, each swimmer keeps only their best time per slot, and slots are re-ranked by time
(ties share a rank) and trimmed to the top 10.

## What counts

- Individual swims with an official time and status VALID/OFFICIAL (or none).
- Skipped: relays, exhibition/time-trial/swim-off events, DQ/DNF/NS, swimmers under 18,
  unknown event or course.
- Racing age follows USMS: SCY = age on the day of the swim, SCM/LCM = age on Dec 31. SCY needs
  a full birth date; if only a birth year is present, an explicit `age` on the result/entry or an
  event `ageGroups` entry is used instead.
- Season: SCM/LCM = calendar year. SCY runs June 1 to May 31, named for the ending year
  (the crawl CSVs list an Oct 2025 meet under SCY 2026).
- `swimmer_id` = last 5 characters of the USMS registration number (matches the crawl's IDs).

## Assumptions to confirm with OpenLane

The SwimJSON spec and schema aren't published yet ("coming soon"). `src/usms_scraper/swimjson.py`
follows the field names in the swimjson.org examples and guesses the rest (marked `ASSUMPTION`):

1. **Document layout:** top-level `meet`, `clubs`, `athletes`, `events` (or nested under
   `sessions`), `entries`, `results`; arrays or id-keyed objects.
2. **Athlete fields:** name (`firstName`/`lastName` or `name`), `sex`, `birthDate` (full date or
   year), `clubId`, and where the USMS registration number lives (`usmsId`? `ids.usms`?).
3. **Club code:** `code` / `abbreviation`, matching USMS club codes (COLM, GSMS...).
4. **Enums:** stroke codes beyond `FREE` (we assume Lenex-style BACK, BREAST, FLY, MEDLEY),
   sex `F`/`M`/`X`, statuses besides VALID/OFFICIAL, eventType values.
5. **Age:** is the racing age or age group recorded on a result or entry?
6. Is there a meet-level sanction/course field, and does the converter keep the meet's
   official name and dates?

## Open questions for the bigger picture

- Would OpenLane publish a schema + test files we can add to `tests/fixtures/swimjson/`?
- Could a USMS results API (our proposal) return SwimJSON, so clubs, LMSCs and OpenLane use one
  format?
- Could LMSCs require meet hosts to post SwimJSON (or HY3) results, as a source independent of
  usms.org?

## Files

- `src/usms_scraper/swimjson.py`: parsing, USMS age/season rules, top-10 merge
- `src/usms_scraper/cli.py`: `ingest-swimjson` command
- `tests/test_swimjson.py`, `tests/fixtures/swimjson/sample_scy_meet.json` (hand-made, fictional)
