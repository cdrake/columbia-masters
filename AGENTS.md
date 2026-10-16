# AGENTS.md

Guidance for coding agents (Codex, Claude Code, etc.) working in this repository. CLAUDE.md
carries the same content in more detail; keep the two in sync.

## Project Overview

Multi-tenant platform for US Masters Swimming club sites (first tenant: COLM). Two halves:

- **Python pipeline** (hatch project, `src/usms_scraper/`) scrapes USMS top-10 listings into
  CSV with Selenium (usms.org sits behind an Azure WAF JavaScript challenge, so plain HTTP
  fails), transforms them to JSON, and rebuilds gallery/locations indexes per tenant.
- **Web app** (`web/`, vanilla TypeScript + Vite) builds one static club site per
  `TENANT=<slug>` from the tenant registry under `tenants/<slug>/`.

## Commands

```bash
hatch shell

# Per-club data refresh (idempotent; no-op when USMS has nothing new)
hatch run refresh                           # all tenants, current year
hatch run refresh -- --tenant colm --full   # one club, all years

# Nationwide paced crawl: every LMSC + club, resumes from data/usms/crawl_state.json
hatch run crawl                             # one slice; scheduled twice daily by usms-crawl.yml
hatch run crawl -- --status                 # progress + next budget, no browser
hatch run crawl -- --reset --lmsc 55 --start-year 2024 --days 1   # small test crawl

# Web
cd web && npm run build
TENANT=<slug> npm run dev

# Lint / test
ruff check src/ && ruff format src/
pytest
```

## Architecture

Pipeline per tenant: **scrape HTML → data/csv/<slug>/ → transform → tenants/<slug>/public/data/ → static build**.

- `src/usms_scraper/cli.py` — argparse CLI: `scrape`, `transform`, `all`, `update`, `publish`,
  `refresh`, `crawl`, plus gallery/locations commands.
- `src/usms_scraper/scraper.py` — `USMSScraper` drives the toptenlocal.php form for one club.
  Module-level `parse_top_ten_html`, `create_driver`, and `write_records_csv` are shared with
  the crawler.
- `src/usms_scraper/crawl.py` — paced nationwide crawl. `LMSCS` table, `CrawlState` checkpoint
  (per-run budget = remaining requests / runs left before the deadline), `UsmsCrawler` loads
  `toptenlocalind.php` GET URLs directly. Phase 1 = LMSC listings (discovers clubs), phase 2 =
  per-club listings. Output under `data/csv/usms/<lmscId>/`.
- `src/usms_scraper/transformer.py` / `models.py` — CSV → `TeamRecord` JSON (camelCase,
  deterministic IDs `{team}_{event}_{course}_{gender}_{ageGroup}`).
- `src/usms_scraper/tenants.py` — tenant registry loader.
- `.github/workflows/usms-crawl.yml` — runs a crawl slice at 03:00 and 15:00 UTC and commits
  results; `workflow_dispatch` with `reset=true` starts a new crawl.

## Key Details

- Records CSV columns are shared (`RECORD_FIELDS` in scraper.py); `team` is the club code.
- `hatch run refresh` and `hatch run crawl` must stay idempotent/resumable.
- USMS HTML parsing lives in `parse_top_ten_html`; check it first if the site changes.
- Ruff config: line-length 100, target Python 3.10.
