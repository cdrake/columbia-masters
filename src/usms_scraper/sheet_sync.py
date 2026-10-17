"""Snapshot each club's Google Sheet into tenants/<slug>/content/fallback/*.json.

The site reads the Sheet live in the browser and in /api/content, but the static
HTML (what search engines and no-JS agents see), JSON-LD, data/site.json and the
static llms.txt are baked from these snapshots at build time. Keeping them current
keeps all of that current.

Stdlib only (no Selenium etc.) so the scheduled GitHub workflow can run it with a
bare Python: ``PYTHONPATH=src python -m usms_scraper.sheet_sync``.

Idempotent: a file is rewritten only when its content changes, in the same format
the web build and editor use (``JSON.stringify(x, null, 2) + "\\n"``), so a run with
no Sheet edits leaves the tree clean and triggers no Pages build.
"""

import argparse
import csv
import io
import json
import logging
import sys
import urllib.request
from pathlib import Path

from .tenants import Tenant, load_tenant, load_tenants

# Tab name -> fallback file; same tabs as SHEET_TABS in web/shared/content.ts.
TABS = ("schedule", "events", "board", "faq", "content")
TIMEOUT = 30


def sheet_url(tenant: Tenant, tab: str) -> str | None:
    """Published-CSV URL for a tab, or None when the tenant has no gid for it."""
    sheet = tenant.raw.get("sheet", {})
    gid = sheet.get("gids", {}).get(tab)
    if gid is None:
        return None
    return (
        f"https://docs.google.com/spreadsheets/d/e/{sheet['publishedId']}/pub"
        f"?gid={gid}&single=true&output=csv"
    )


def fetch_csv(url: str) -> list[dict[str, str]]:
    """Download a published tab. Raises if Google doesn't answer with CSV
    (an unpublished Sheet returns an HTML sign-in page with status 200)."""
    req = urllib.request.Request(url, headers={"User-Agent": "swimclubs-sheet-sync"})
    with urllib.request.urlopen(req, timeout=TIMEOUT) as res:
        ctype = res.headers.get("Content-Type", "")
        if "text/csv" not in ctype:
            raise ValueError(f"expected text/csv, got {ctype or 'no content type'}")
        text = res.read().decode("utf-8-sig")
    reader = csv.DictReader(io.StringIO(text, newline=""))
    if reader.fieldnames:
        reader.fieldnames = [h.strip() for h in reader.fieldnames]
    return [dict(row) for row in reader]


def _cell(row: dict, key: str) -> str:
    value = row.get(key)
    return "" if value is None else str(value).strip()


def normalize_tab(tab: str, rows: list[dict]) -> list | dict:
    """Canonical row shapes. Mirrors normalizeTab() in web/shared/content.ts; keep in step."""
    if tab == "schedule":
        out = []
        for r in rows:
            entry = {"day": _cell(r, "day"), "time": _cell(r, "time")}
            if _cell(r, "location"):
                entry["location"] = _cell(r, "location")
            if _cell(r, "type"):
                entry["type"] = _cell(r, "type")
            if entry["day"]:
                out.append(entry)
        return out
    if tab == "events":
        keys = ("date", "endDate", "title", "location", "notes", "url")
        return [{k: _cell(r, k) for k in keys} for r in rows if _cell(r, "title")]
    if tab == "board":
        return [
            {"role": _cell(r, "role"), "name": _cell(r, "name")} for r in rows if _cell(r, "name")
        ]
    if tab == "faq":
        return [
            {"question": _cell(r, "question"), "answer": _cell(r, "answer")}
            for r in rows
            if _cell(r, "question") and _cell(r, "answer")
        ]
    if tab == "content":
        return {_cell(r, "key"): _cell(r, "value") for r in rows if _cell(r, "key")}
    raise ValueError(f"unknown tab {tab!r}")


def to_json(data) -> str:
    """Same bytes as JSON.stringify(data, null, 2) + "\\n"."""
    return json.dumps(data, indent=2, ensure_ascii=False) + "\n"


def write_if_changed(path: Path, text: str) -> bool:
    if path.exists() and path.read_text(encoding="utf-8") == text:
        return False
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    return True


def agent_links(domain: str) -> dict:
    """data/index.json pointers to the agent-facing endpoints (see web/shared/content.ts)."""
    return {
        "contentApi": {
            "url": f"{domain}/api/content",
            "method": "GET",
            "description": (
                "Club information read live from the club's Google Sheet: practice schedule, "
                "upcoming events, board, FAQ, coaches and any notice. Optional section="
                "club|alert|about|schedule|events|board|faq|coaches; format=md for markdown."
            ),
        },
        "openapi": f"{domain}/openapi.json",
        "llms": f"{domain}/llms.txt",
    }


def sync_index_links(tenant: Tenant) -> bool:
    """Add/refresh the agent endpoint keys in data/index.json without touching lastUpdated."""
    index_path = tenant.web_data_dir / "index.json"
    if not index_path.exists():
        return False
    text = index_path.read_text(encoding="utf-8")
    index = json.loads(text)
    index.update(agent_links(tenant.domain))
    return write_if_changed(index_path, to_json(index))


def sync_tenant(tenant: Tenant) -> tuple[list[str], list[str]]:
    """Snapshot every configured tab. Returns (changed files, failed tabs).
    A tab that can't be read keeps its previous snapshot."""
    fallback_dir = tenant.root / "content" / "fallback"
    changed: list[str] = []
    failed: list[str] = []
    for tab in TABS:
        url = sheet_url(tenant, tab)
        if url is None:
            continue
        try:
            data = normalize_tab(tab, fetch_csv(url))
        except Exception as e:  # network, HTTP, non-CSV reply
            logging.warning(f"  {tenant.slug}/{tab}: Sheet unavailable ({e}); keeping snapshot")
            failed.append(tab)
            continue
        # An empty tab is almost always a publishing hiccup, not a real edit; keep the snapshot.
        if not data and tab != "faq":
            logging.warning(f"  {tenant.slug}/{tab}: Sheet tab is empty; keeping snapshot")
            failed.append(tab)
            continue
        path = fallback_dir / f"{tab}.json"
        if write_if_changed(path, to_json(data)):
            logging.info(f"  updated {path}")
            changed.append(str(path))
    if sync_index_links(tenant):
        changed.append(str(tenant.web_data_dir / "index.json"))
    if not changed:
        logging.info(f"  {tenant.slug}: Sheet snapshot unchanged")
    return changed, failed


def run(slug: str | None) -> int:
    tenants = [load_tenant(slug)] if slug else load_tenants()
    any_failed = False
    for tenant in tenants:
        logging.info(f"=== {tenant.slug}: syncing Sheet content ===")
        _, failed = sync_tenant(tenant)
        any_failed = any_failed or bool(failed)
    return 1 if any_failed else 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Snapshot each club's Google Sheet into content/fallback/*.json"
    )
    parser.add_argument("--tenant", default=None, help="Only this tenant slug (default: all)")
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    return run(args.tenant)


if __name__ == "__main__":
    sys.exit(main())
