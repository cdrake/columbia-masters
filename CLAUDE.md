# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Multi-tenant platform for US Masters Swimming club sites (first tenant: COLM). Two halves:

- **Python pipeline** (hatch project, `src/usms_scraper/`) scrapes USMS team records into CSV, transforms to JSON, and rebuilds gallery/locations indexes — per tenant.
- **Web app** (`web/`, vanilla TypeScript + Vite, no framework) builds one static club site per `TENANT=<slug>` from the tenant registry. Each club is its own Cloudflare Pages project on this repo (root dir `web`, build `npm run build`, env `TENANT=<slug>`).

## Commands

```bash
# Enter dev environment
hatch shell

# One-shot data refresh (ALL tenants: scrape current year, rebuild JSON + indexes)
hatch run refresh
hatch run refresh -- --tenant colm --full   # one club, all years from records.startYear
hatch run refresh -- --skip-scrape          # indexes only, no network

# Single-club update / publish (tenant-aware defaults)
hatch run update -- --tenant colm
hatch run publish -- --tenant colm

# Gallery / locations (default to --tenant colm)
hatch run gallery-add -- --name "2026 Cola Classic" --type meet --course lcm
hatch run gallery-index
hatch run locations-index

# Web
cd web && npm run build          # builds default tenant (colm)
TENANT=<slug> npm run dev        # dev-serve any club with live reload

# Lint
ruff check src/
ruff format src/
```

## Architecture

Pipeline per tenant: **scrape HTML → data/csv/<slug>/ → transform → tenants/<slug>/public/data/ → static build**.

- `tenants/<slug>/` — the tenant registry. `tenant.json` (identity, domain, colors, socials, Google Sheet publishedId + per-tab gids, lmscId, records.startYear), `content/` (about.md, coaches/*.md with frontmatter, classes/*.md, fallback/{schedule,events,board}.json, pages/*.json — editor-managed page layouts, home.json = `/`, optional site.json — design theme + accent), and `public/` (that club's static assets + generated data/gallery/locations indexes; becomes Vite's publicDir).
- `src/usms_scraper/tenants.py` — `Tenant` dataclass + `load_tenants()`; path properties for all per-tenant dirs.
- `src/usms_scraper/cli.py` — argparse CLI. `refresh` is the one-shot across tenants; `update`/`publish` and the gallery/locations commands accept `--tenant` and derive defaults from the registry. Core helpers: `_scrape_and_diff` (idempotent CSV update), `_publish_records` (transform + copy + index.json), `_update_data_index` (creates data/index.json from tenant.json when missing).
- `src/usms_scraper/scraper.py` — `USMSScraper` fetches USMS top-times pages; `ScraperConfig` holds URL patterns that may need updating if the USMS site changes.
- `src/usms_scraper/transformer.py` / `models.py` — CSV → `TeamRecord` JSON (camelCase for the site; deterministic IDs `{team}_{event}_{course}_{gender}_{ageGroup}`).
- `web/build/` — Vite tenant plugin: `load-tenant.ts` (load + validate tenant files incl. pages), `render.ts` (HTML renderers for head/JSON-LD/sections), `pages.ts` (markers, nav, `composePage`), `sections/*.html` (built-in section partials, one per home section), `tenant-plugin.ts` (a `tenant-theme` pre-order plugin injects the theme stylesheet/fonts at `<!-- tenant:theme -->` and `data-theme` + accent vars on `<html>` so Vite bundles the CSS; transformIndexHtml shell; `generateBundle` composes `index.html` + `<slug>/index.html` per page; `virtual:tenant`; robots/sitemap/llms), `admin-dev-api.ts` (dev-only `/api/admin/*` that writes tenant files).
- `web/index.html` — the page shell (head, nav, footer) with `<!-- tenant:page-nav -->` / `<!-- tenant:page-body -->`; sections live in `web/build/sections/`. Element ids must be preserved: the runtime (main.ts) and the Google Sheet content-tab overrides target them. main.ts must stay null-safe — sections can be hidden or absent (non-home pages).
- `web/shared/` — browser-safe code used by build, editor and Functions: `pages.ts` (Page/Block schema, `validatePage`, safe markdown + embed allowlist, `renderContentBlock`), `publish.ts` (`/api/admin` contract + validation), `site.ts` (theme registry `THEMES`, `validateSite`, accent contrast).
- Page editor: `web/admin/index.html` + `web/src/admin/` (vanilla TS + SortableJS), served at `/admin/`. Production API is Cloudflare Pages Functions in `web/functions/api/admin/` (Access JWT check in `_middleware.ts`; `publish.ts` commits via GitHub Git Data API, 409 on conflicts). Setup steps: README "Editing the Site".
- `web/src/themes/<id>.css` — design themes, CSS-only and scoped by `[data-theme]` (token block `:root[data-theme=…]` so it outranks style.css in any load order). Lane Line is plain style.css. The editor's Design gallery (`web/src/admin/design.ts`) previews them on the canvas.
- `web/src/main.ts` — all runtime rendering; fetches records via `tenant.teamCode`, Sheet CSVs via `virtual:tenant` sheetUrls, gallery/locations index.json.

## Key Details

- The Sheet `content` tab overrides baked-in HTML at runtime (keys: hero_sub, about_text, alert_message, location_info_<slug>, …) — template changes must keep those element ids.
- Fallback schedule/events/board/faq in tenants/<slug>/content/fallback/ are intentional static/SEO content (rendered into HTML at build), replaced at runtime by Sheet data when available.
- The `faq` Sheet tab is optional (gid lives at `sheet.gids.faq`); tenants without it just show the static fallback. See README.md "Adding the FAQ Tab" for setup.
- `hatch run refresh` must stay idempotent: no-op when USMS has no new records and indexes are current.
- USMS HTML parsing in `_parse_results_table()` is generic and may need adjustment when the site structure changes — check `ScraperConfig` URL patterns first.
- Ruff config: line-length 100, target Python 3.10. Web: `tsc && vite build` typechecks `web/src/` only (web/build/ is bundled by Vite's esbuild).
- Admin editor commits land on `main` (`[admin:<slug>] …` commits); pull before pushing refresh commits. Page JSON is written as `JSON.stringify(page, null, 2) + "\n"` — keep hand edits in that format so no-op publishes don't produce diffs.
- Migration/infra history: `MIGRATION_CLOUDFLARE.md` (GitHub Pages → Cloudflare, DNS rollback snapshot).
