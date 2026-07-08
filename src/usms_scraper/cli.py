"""Command-line interface for USMS scraper."""

import argparse
import csv
import json
import logging
import shutil
import sys
from datetime import date
from pathlib import Path

from .gallery import build_index, create_event_folder, init_from_records
from .locations import build_index as build_locations_index, create_location_folder
from .scraper import scrape_team_records, ScraperConfig, USMSScraper
from .tenants import Tenant, load_tenant, load_tenants
from .transformer import (
    transform_multiple_csvs,
    generate_firebase_import,
    generate_ndjson,
)


def setup_logging(verbose: bool = False) -> None:
    """Configure logging."""
    level = logging.DEBUG if verbose else logging.INFO
    logging.basicConfig(
        level=level,
        format="%(asctime)s [%(levelname)s] %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )


def parse_years(years_str: str) -> list[int]:
    """Parse a year range string like '2015-2025' or '2020,2021,2023' into a list of ints."""
    if "-" in years_str and "," not in years_str:
        parts = years_str.split("-")
        return list(range(int(parts[0]), int(parts[1]) + 1))
    return [int(y.strip()) for y in years_str.split(",")]


def cmd_scrape(args: argparse.Namespace) -> int:
    """Run the scraper command."""
    output_dir = Path(args.output)
    years = parse_years(args.years)
    courses = [c.strip().upper() for c in args.courses.split(",")]

    logging.info(f"Scraping records for team: {args.team}")
    logging.info(f"Years: {years[0]}-{years[-1]}, Courses: {courses}, LMSC: {args.lmsc}")

    try:
        csv_files = scrape_team_records(
            team_code=args.team,
            output_dir=output_dir,
            lmsc_id=args.lmsc,
            years=years,
            courses=courses,
            delay=args.delay,
            headless=not args.show_browser,
            save_debug_html=args.debug_html,
        )

        logging.info(f"Created {len(csv_files)} CSV files:")
        for f in csv_files:
            logging.info(f"  - {f}")

        return 0

    except Exception as e:
        logging.error(f"Scraping failed: {e}")
        return 1


def cmd_transform(args: argparse.Namespace) -> int:
    """Run the transform command."""
    input_path = Path(args.input)
    output_dir = Path(args.output)

    try:
        if input_path.is_file():
            csv_files = [input_path]
        elif input_path.is_dir():
            csv_files = list(input_path.glob("*.csv"))
            if not csv_files:
                logging.error(f"No CSV files found in {input_path}")
                return 1
        else:
            logging.error(f"Input path does not exist: {input_path}")
            return 1

        logging.info(f"Transforming {len(csv_files)} CSV file(s)...")

        combined_path = output_dir / f"{args.team}_all_records.json" if args.combine else None

        all_records = transform_multiple_csvs(
            csv_paths=csv_files,
            output_dir=output_dir,
            combined_output=combined_path,
            pretty=not args.minify,
        )

        combined_records = []
        for records in all_records.values():
            combined_records.extend(records)

        if args.firebase:
            firebase_path = output_dir / f"{args.team}_firebase_import.json"
            generate_firebase_import(combined_records, firebase_path)

        if args.ndjson:
            ndjson_path = output_dir / f"{args.team}_records.ndjson"
            generate_ndjson(combined_records, ndjson_path)

        logging.info(f"Transformation complete. Output in {output_dir}")
        return 0

    except Exception as e:
        logging.error(f"Transform failed: {e}")
        return 1


def _record_key(record: dict) -> tuple:
    """Key that identifies a unique slot: event + course + gender + age_group + rank."""
    return (
        record["event"],
        record["course"],
        record["gender"],
        record["age_group"],
        record["rank"],
    )


def _record_content(record: dict) -> tuple:
    """Content tuple for change detection."""
    return (record["time"], record["swimmer"], record["meet"])


def _load_existing_csv(path: Path) -> list[dict]:
    """Load records from an existing CSV file."""
    if not path.exists():
        return []
    with open(path, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def _save_records_csv(records: list[dict], path: Path) -> None:
    """Write records to a CSV file."""
    fieldnames = [
        "team",
        "event",
        "course",
        "gender",
        "age_group",
        "time",
        "swimmer",
        "date",
        "meet",
        "year",
        "rank",
    ]
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(records)


def _new_data_index(tenant: Tenant, record_count: int) -> dict:
    """Create a fresh data index.json from tenant config."""
    c = tenant.raw
    city_region = f"{c['address']['city']}, {c['address']['region']}"
    return {
        "name": f"{tenant.name} ({tenant.team_code}) — Team Records",
        "description": (
            f"Top times and team records for {tenant.team_code}, a US Masters Swimming club "
            f"in {city_region}. Each record represents the fastest time by a "
            f"{tenant.team_code} swimmer in a given event, course, gender, and age group."
        ),
        "organization": {
            "name": tenant.name,
            "teamCode": tenant.team_code,
            "location": city_region,
            "website": tenant.domain,
        },
        "datasets": [
            {
                "name": "All Team Records",
                "url": f"{tenant.domain}/data/{tenant.team_code}_all_records.json",
                "format": "JSON array",
                "records": record_count,
                "description": (
                    f"All {tenant.team_code} top times across every course, event, "
                    f"gender, and age group."
                ),
                "schema": {
                    "id": "Deterministic key: {team}_{event}_{course}_{gender}_{ageGroup}",
                    "team": f"USMS team code (always {tenant.team_code})",
                    "event": "Event name, e.g. '100 Y Freestyle'",
                    "course": (
                        "Pool course: scy (Short Course Yards), scm (Short Course Meters), "
                        "or lcm (Long Course Meters)"
                    ),
                    "gender": "men or women",
                    "ageGroup": "USMS age group, e.g. '25-29', '30-34'",
                    "time": "Formatted swim time, e.g. '1:01.29'",
                    "timeInSeconds": "Numeric time in seconds for sorting/comparison",
                    "swimmer": "Swimmer's full name",
                    "date": "Date of the swim (ISO string or null)",
                    "meet": "Name of the meet where the time was recorded",
                    "year": "Year the time was recorded",
                },
            }
        ],
        "source": "US Masters Swimming (usms.org) top times database",
    }


def _update_data_index(web_data_dir: Path, record_count: int, tenant: Tenant | None = None) -> None:
    """Update records count and lastUpdated in index.json, creating it from tenant if missing."""
    index_path = web_data_dir / "index.json"
    if index_path.exists():
        with open(index_path, "r", encoding="utf-8") as f:
            index = json.load(f)
    elif tenant is not None:
        index = _new_data_index(tenant, record_count)
    else:
        return
    for dataset in index.get("datasets", []):
        dataset["records"] = record_count
    index["lastUpdated"] = date.today().isoformat()
    with open(index_path, "w", encoding="utf-8") as f:
        json.dump(index, f, indent=2, ensure_ascii=False)
        f.write("\n")
    logging.info(f"  Updated {index_path} (records: {record_count}, date: {index['lastUpdated']})")


def _scrape_and_diff(
    team: str,
    csv_dir: Path,
    lmsc_id: str,
    years: list[int],
    courses: list[str],
    delay: float,
    headless: bool = True,
    save_debug_html: bool = False,
) -> bool:
    """Scrape the given years and update CSVs only when records changed. Returns True on change."""
    config = ScraperConfig(
        team_code=team,
        output_dir=csv_dir,
        lmsc_id=lmsc_id,
        years=years,
        courses=courses,
        delay_between_requests=delay,
        headless=headless,
        save_debug_html=save_debug_html,
    )
    scraper = USMSScraper(config)
    scraped = scraper.scrape_all_raw()

    any_changes = False

    for (year, course), new_records in scraped.items():
        csv_path = csv_dir / f"{team}_{course.lower()}_{year}_records.csv"
        existing = _load_existing_csv(csv_path)

        # Build lookup of existing records by key
        existing_by_key = {_record_key(r): _record_content(r) for r in existing}
        new_by_key = {_record_key(r): _record_content(r) for r in new_records}

        # Detect changes
        added = []
        updated = []
        for r in new_records:
            key = _record_key(r)
            if key not in existing_by_key:
                added.append(r)
            elif _record_content(r) != existing_by_key[key]:
                updated.append(r)

        if not added and not updated and len(new_records) == len(existing):
            logging.info(f"  {course} {year}: no changes")
            continue

        any_changes = True

        if added:
            logging.info(f"  {course} {year}: {len(added)} new record(s)")
            for r in added:
                logging.info(
                    f"    + {r['gender']} {r['age_group']} {r['event']}"
                    f" — {r['time']} ({r['swimmer']})"
                )

        if updated:
            logging.info(f"  {course} {year}: {len(updated)} updated record(s)")
            for r in updated:
                key = _record_key(r)
                old = existing_by_key[key]
                logging.info(
                    f"    ~ {r['gender']} {r['age_group']} {r['event']}"
                    f" — {old[0]} -> {r['time']} ({r['swimmer']})"
                )

        removed_count = len(existing_by_key) - len(set(existing_by_key) & set(new_by_key))
        if removed_count:
            logging.info(f"  {course} {year}: {removed_count} record(s) no longer in results")

        _save_records_csv(new_records, csv_path)
        logging.info(f"  Wrote {len(new_records)} records to {csv_path.name}")

    return any_changes


def _publish_records(
    team: str,
    csv_dir: Path,
    json_dir: Path,
    web_data_dir: Path,
    firebase: bool = False,
    tenant: Tenant | None = None,
) -> int:
    """Transform all CSVs and copy the combined JSON to the web data dir. Returns record count."""
    csv_files = list(csv_dir.glob("*.csv"))
    if not csv_files:
        raise FileNotFoundError(f"No CSV files found in {csv_dir}")

    logging.info(f"Transforming {len(csv_files)} CSV file(s)...")
    json_dir.mkdir(parents=True, exist_ok=True)

    combined_path = json_dir / f"{team}_all_records.json"
    all_records = transform_multiple_csvs(
        csv_paths=csv_files,
        output_dir=json_dir,
        combined_output=combined_path,
        pretty=True,
    )

    combined_records = []
    for records in all_records.values():
        combined_records.extend(records)

    if firebase:
        firebase_path = json_dir / f"{team}_firebase_import.json"
        generate_firebase_import(combined_records, firebase_path)
        logging.info(f"  Firebase import: {firebase_path}")

    logging.info(f"  Transform complete. Output in {json_dir}")

    web_data_dir.mkdir(parents=True, exist_ok=True)
    dest = web_data_dir / combined_path.name
    shutil.copy2(combined_path, dest)
    logging.info(f"  Updated website data: {dest}")

    _update_data_index(web_data_dir, len(combined_records), tenant)

    return len(combined_records)


def cmd_update(args: argparse.Namespace) -> int:
    """Scrape the current year and only update CSVs when new or changed records are found."""
    tenant = load_tenant(args.tenant) if args.tenant else None
    team = args.team or (tenant.team_code if tenant else None)
    if not team:
        logging.error("Provide --team or --tenant")
        return 1
    lmsc = args.lmsc or (tenant.lmsc_id if tenant else "55")
    csv_dir = (
        Path(args.output) if args.output else (tenant.csv_dir if tenant else Path("./data/csv"))
    )
    json_dir = (
        Path(args.json_output)
        if args.json_output
        else (tenant.json_dir if tenant else Path("./data/json"))
    )
    web_data_dir = (
        Path(args.web_data) if args.web_data else (tenant.web_data_dir if tenant else None)
    )
    if web_data_dir is None:
        logging.error("Provide --web-data or --tenant")
        return 1

    current_year = date.today().year
    courses = [c.strip().upper() for c in args.courses.split(",")]

    logging.info(f"Updating {team} records for {current_year} ({', '.join(courses)})")

    try:
        any_changes = _scrape_and_diff(
            team=team,
            csv_dir=csv_dir,
            lmsc_id=lmsc,
            years=[current_year],
            courses=courses,
            delay=args.delay,
            headless=not args.show_browser,
            save_debug_html=args.debug_html,
        )

        if not any_changes:
            logging.info("No changes detected — data is up to date.")
            return 0

        logging.info("Running transform...")
        _publish_records(
            team=team,
            csv_dir=csv_dir,
            json_dir=json_dir,
            web_data_dir=web_data_dir,
            firebase=args.firebase,
            tenant=tenant,
        )
        return 0

    except Exception as e:
        logging.error(f"Update failed: {e}")
        return 1


def cmd_refresh(args: argparse.Namespace) -> int:
    """One-shot: refresh records + gallery/locations indexes for all tenants (or one)."""
    if args.tenant:
        tenants = [load_tenant(args.tenant)]
    else:
        tenants = load_tenants()
    if not tenants:
        logging.error("No tenants found under tenants/")
        return 1

    courses = [c.strip().upper() for c in args.courses.split(",")]
    current_year = date.today().year
    failures: list[str] = []

    for tenant in tenants:
        logging.info(f"=== {tenant.slug} ({tenant.team_code}) ===")
        try:
            changed = False
            if not args.skip_scrape:
                years = (
                    list(range(tenant.start_year, current_year + 1))
                    if args.full
                    else [current_year]
                )
                changed = _scrape_and_diff(
                    team=tenant.team_code,
                    csv_dir=tenant.csv_dir,
                    lmsc_id=tenant.lmsc_id,
                    years=years,
                    courses=courses,
                    delay=args.delay,
                    headless=True,
                    save_debug_html=False,
                )

            records_json = tenant.web_data_dir / f"{tenant.team_code}_all_records.json"
            if changed or args.full or not records_json.exists():
                _publish_records(
                    team=tenant.team_code,
                    csv_dir=tenant.csv_dir,
                    json_dir=tenant.json_dir,
                    web_data_dir=tenant.web_data_dir,
                    tenant=tenant,
                )
            else:
                logging.info("  Records unchanged — skipping transform.")

            if tenant.gallery_dir.exists():
                _write_gallery_index(tenant.gallery_dir)
            if tenant.locations_dir.exists():
                _write_locations_index(tenant.locations_dir)

        except Exception as e:
            logging.error(f"  {tenant.slug} failed: {e}")
            failures.append(tenant.slug)

    ok = len(tenants) - len(failures)
    logging.info(f"Refresh complete: {ok}/{len(tenants)} tenant(s) OK")
    if failures:
        logging.error(f"Failed tenants: {', '.join(failures)}")
        return 1
    return 0


def cmd_publish(args: argparse.Namespace) -> int:
    """Transform existing CSVs and copy JSON to the web public data directory."""
    tenant = load_tenant(args.tenant) if args.tenant else None
    team = args.team or (tenant.team_code if tenant else None)
    if not team:
        logging.error("Provide --team or --tenant")
        return 1
    csv_dir = (
        Path(args.csv_input)
        if args.csv_input
        else (tenant.csv_dir if tenant else Path("./data/csv"))
    )
    json_dir = (
        Path(args.json_output)
        if args.json_output
        else (tenant.json_dir if tenant else Path("./data/json"))
    )
    web_data_dir = (
        Path(args.web_data) if args.web_data else (tenant.web_data_dir if tenant else None)
    )
    if web_data_dir is None:
        logging.error("Provide --web-data or --tenant")
        return 1

    try:
        count = _publish_records(
            team=team,
            csv_dir=csv_dir,
            json_dir=json_dir,
            web_data_dir=web_data_dir,
            firebase=args.firebase,
            tenant=tenant,
        )
        logging.info(f"  Total records: {count}")
        return 0
    except Exception as e:
        logging.error(f"Publish failed: {e}")
        return 1


def _tenant_dir(args: argparse.Namespace, attr: str, override: str | None) -> Path:
    """Resolve a directory from an explicit flag or the --tenant registry entry."""
    if override:
        return Path(override)
    tenant = load_tenant(args.tenant)
    return getattr(tenant, attr)


def cmd_gallery_init(args: argparse.Namespace) -> int:
    """Scan meet names from CSVs and create a gallery folder for each."""
    gallery_dir = _tenant_dir(args, "gallery_dir", args.gallery_dir)
    csv_dir = _tenant_dir(args, "csv_dir", args.csv_input)

    if not csv_dir.exists():
        logging.error(f"CSV directory not found: {csv_dir}")
        return 1

    gallery_dir.mkdir(parents=True, exist_ok=True)
    logging.info(f"Initializing gallery folders from {csv_dir}...")
    folders = init_from_records(gallery_dir, csv_dir)
    logging.info(f"Done. {len(folders)} event folder(s) in {gallery_dir}")

    # Auto-generate index
    _write_gallery_index(gallery_dir)
    return 0


def cmd_gallery_add(args: argparse.Namespace) -> int:
    """Add a gallery event folder (for social events or manual meets)."""
    gallery_dir = _tenant_dir(args, "gallery_dir", args.gallery_dir)
    gallery_dir.mkdir(parents=True, exist_ok=True)

    folder = create_event_folder(
        gallery_dir,
        name=args.name,
        date=args.date or "",
        description=args.description or "",
        event_type=args.type,
        course=args.course or "",
    )
    logging.info(f"Event folder ready: {folder}")
    logging.info("Drop images into this folder, then run: hatch run gallery-index")

    # Auto-generate index
    _write_gallery_index(gallery_dir)
    return 0


def cmd_gallery_index(args: argparse.Namespace) -> int:
    """Scan gallery folders and regenerate index.json."""
    gallery_dir = _tenant_dir(args, "gallery_dir", args.gallery_dir)

    if not gallery_dir.exists():
        logging.error(f"Gallery directory not found: {gallery_dir}")
        return 1

    _write_gallery_index(gallery_dir)
    return 0


def _write_gallery_index(gallery_dir: Path) -> None:
    """Build and write the gallery index.json."""
    index = build_index(gallery_dir)
    index_path = gallery_dir / "index.json"
    with open(index_path, "w", encoding="utf-8") as f:
        json.dump(index, f, indent=2, ensure_ascii=False)
        f.write("\n")

    total_photos = sum(len(e["photos"]) for e in index["events"])
    logging.info(
        f"Gallery index: {len(index['events'])} event(s), {total_photos} photo(s) → {index_path}"
    )


def cmd_locations_add(args: argparse.Namespace) -> int:
    """Create a location folder for practice location images."""
    locations_dir = _tenant_dir(args, "locations_dir", args.locations_dir)
    locations_dir.mkdir(parents=True, exist_ok=True)
    create_location_folder(locations_dir, args.name)
    _write_locations_index(locations_dir)
    return 0


def cmd_locations_index(args: argparse.Namespace) -> int:
    """Scan location folders and regenerate locations/index.json."""
    locations_dir = _tenant_dir(args, "locations_dir", args.locations_dir)
    if not locations_dir.exists():
        logging.error(f"Locations directory not found: {locations_dir}")
        return 1
    _write_locations_index(locations_dir)
    return 0


def _write_locations_index(locations_dir: Path) -> None:
    """Build and write the locations index.json."""
    index = build_locations_index(locations_dir)
    index_path = locations_dir / "index.json"
    with open(index_path, "w", encoding="utf-8") as f:
        json.dump(index, f, indent=2, ensure_ascii=False)
        f.write("\n")
    total_photos = sum(len(loc["photos"]) for loc in index["locations"])
    logging.info(
        f"Locations index: {len(index['locations'])} location(s), "
        f"{total_photos} photo(s) → {index_path}"
    )


def cmd_all(args: argparse.Namespace) -> int:
    """Run scrape + transform."""
    args.output = args.csv_output
    result = cmd_scrape(args)
    if result != 0:
        return result

    args.input = args.csv_output
    args.output = args.json_output
    args.combine = True
    return cmd_transform(args)


def main() -> int:
    """Main entry point."""
    parser = argparse.ArgumentParser(
        description="Scrape USMS team records and transform to JSON for Firebase",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Scrape COLM records
  usms-scraper scrape --team COLM --output ./data/csv

  # Scrape specific years
  usms-scraper scrape --team COLM --years 2020-2024

  # Scrape only SCY
  usms-scraper scrape --team COLM --courses SCY

  # Transform CSVs to JSON
  usms-scraper transform --input ./data/csv --output ./data/json --team COLM --firebase

  # Do both in one command
  usms-scraper all --team COLM --csv-output ./data/csv --json-output ./data/json
        """,
    )

    parser.add_argument("-v", "--verbose", action="store_true", help="Enable debug logging")

    subparsers = parser.add_subparsers(dest="command", required=True)

    # Scrape command
    scrape_parser = subparsers.add_parser("scrape", help="Scrape records from USMS")
    scrape_parser.add_argument("--team", "-t", required=True, help="Team code (e.g., COLM)")
    scrape_parser.add_argument(
        "--output", "-o", default="./output/csv", help="Output directory for CSVs"
    )
    scrape_parser.add_argument(
        "--years",
        "-y",
        default=f"2015-{date.today().year}",
        help="Year range (e.g., 2015-2025) or comma-separated (e.g., 2020,2022,2024)",
    )
    scrape_parser.add_argument(
        "--courses",
        default="SCY,SCM,LCM",
        help="Comma-separated courses (default: SCY,SCM,LCM)",
    )
    scrape_parser.add_argument(
        "--lmsc",
        default="55",
        help="LMSC ID (default: 55 for South Carolina)",
    )
    scrape_parser.add_argument(
        "--delay",
        "-d",
        type=float,
        default=2.0,
        help="Delay between requests in seconds (default: 2.0)",
    )
    scrape_parser.add_argument(
        "--show-browser",
        action="store_true",
        help="Show browser window (default: headless)",
    )
    scrape_parser.add_argument(
        "--debug-html",
        action="store_true",
        help="Save raw HTML pages for debugging",
    )
    scrape_parser.add_argument("-v", "--verbose", action="store_true", help="Enable debug logging")
    scrape_parser.set_defaults(func=cmd_scrape)

    # Transform command
    transform_parser = subparsers.add_parser("transform", help="Transform CSV to JSON")
    transform_parser.add_argument("--input", "-i", required=True, help="Input CSV file or dir")
    transform_parser.add_argument(
        "--output", "-o", default="./output/json", help="Output directory for JSON"
    )
    transform_parser.add_argument(
        "--team", "-t", default="team", help="Team code for output filenames"
    )
    transform_parser.add_argument(
        "--combine", "-c", action="store_true", help="Create combined JSON file"
    )
    transform_parser.add_argument(
        "--firebase", "-f", action="store_true", help="Generate Firebase import format"
    )
    transform_parser.add_argument(
        "--ndjson", "-n", action="store_true", help="Generate NDJSON format"
    )
    transform_parser.add_argument("--minify", "-m", action="store_true", help="Minify JSON output")
    transform_parser.add_argument(
        "-v", "--verbose", action="store_true", help="Enable debug logging"
    )
    transform_parser.set_defaults(func=cmd_transform)

    # Update command (current year only, idempotent)
    update_parser = subparsers.add_parser(
        "update", help="Scrape current year and update only if new/changed records found"
    )
    update_parser.add_argument(
        "--tenant", default=None, help="Tenant slug — resolves team/lmsc/paths from tenants/"
    )
    update_parser.add_argument("--team", "-t", default=None, help="Team code (e.g., COLM)")
    update_parser.add_argument(
        "--output", "-o", default=None, help="Output directory for CSVs (default: tenant's)"
    )
    update_parser.add_argument(
        "--courses",
        default="SCY,SCM,LCM",
        help="Comma-separated courses (default: SCY,SCM,LCM)",
    )
    update_parser.add_argument(
        "--lmsc",
        default=None,
        help="LMSC ID (default: tenant's, or 55)",
    )
    update_parser.add_argument(
        "--delay", "-d", type=float, default=2.0, help="Delay between requests (seconds)"
    )
    update_parser.add_argument("--show-browser", action="store_true", help="Show browser window")
    update_parser.add_argument(
        "--debug-html", action="store_true", help="Save raw HTML for debugging"
    )
    update_parser.add_argument(
        "--json-output", default=None, help="Output directory for JSON (default: tenant's)"
    )
    update_parser.add_argument(
        "--web-data",
        default=None,
        help="Web public data directory for website JSON (default: tenant's)",
    )
    update_parser.add_argument(
        "--firebase",
        "-f",
        action="store_true",
        help="Generate Firebase import format (with --transform)",
    )
    update_parser.add_argument("-v", "--verbose", action="store_true", help="Enable debug logging")
    update_parser.set_defaults(func=cmd_update)

    # Publish command (transform + copy to web)
    publish_parser = subparsers.add_parser(
        "publish", help="Transform existing CSVs and copy JSON to the website"
    )
    publish_parser.add_argument(
        "--tenant", default=None, help="Tenant slug — resolves team/paths from tenants/"
    )
    publish_parser.add_argument("--team", "-t", default=None, help="Team code (e.g., COLM)")
    publish_parser.add_argument(
        "--csv-input", default=None, help="Directory containing CSV files (default: tenant's)"
    )
    publish_parser.add_argument(
        "--json-output", default=None, help="Output directory for JSON (default: tenant's)"
    )
    publish_parser.add_argument(
        "--web-data",
        default=None,
        help="Web public data directory (default: tenant's)",
    )
    publish_parser.add_argument(
        "--firebase", "-f", action="store_true", help="Generate Firebase import format"
    )
    publish_parser.add_argument("-v", "--verbose", action="store_true", help="Enable debug logging")
    publish_parser.set_defaults(func=cmd_publish)

    # Gallery init command
    gi_parser = subparsers.add_parser(
        "gallery-init", help="Create gallery folders from existing meet records"
    )
    gi_parser.add_argument("--tenant", default="colm", help="Tenant slug (default: colm)")
    gi_parser.add_argument(
        "--csv-input", default=None, help="Directory containing record CSVs (default: tenant's)"
    )
    gi_parser.add_argument(
        "--gallery-dir",
        default=None,
        help="Gallery directory (default: tenant's)",
    )
    gi_parser.add_argument("-v", "--verbose", action="store_true", help="Enable debug logging")
    gi_parser.set_defaults(func=cmd_gallery_init)

    # Gallery add command
    ga_parser = subparsers.add_parser(
        "gallery-add", help="Add a gallery event folder (meets or social events)"
    )
    ga_parser.add_argument("--name", "-n", required=True, help="Event name")
    ga_parser.add_argument("--date", "-d", default="", help="Event date (YYYY-MM-DD)")
    ga_parser.add_argument("--description", default="", help="Event description")
    ga_parser.add_argument(
        "--type",
        default="social",
        choices=["meet", "social"],
        help="Event type (default: social)",
    )
    ga_parser.add_argument("--course", default="", help="Course code (scy/scm/lcm) for meets")
    ga_parser.add_argument("--tenant", default="colm", help="Tenant slug (default: colm)")
    ga_parser.add_argument(
        "--gallery-dir",
        default=None,
        help="Gallery directory (default: tenant's)",
    )
    ga_parser.add_argument("-v", "--verbose", action="store_true", help="Enable debug logging")
    ga_parser.set_defaults(func=cmd_gallery_add)

    # Gallery index command
    gx_parser = subparsers.add_parser(
        "gallery-index", help="Regenerate gallery index.json from event folders"
    )
    gx_parser.add_argument("--tenant", default="colm", help="Tenant slug (default: colm)")
    gx_parser.add_argument(
        "--gallery-dir",
        default=None,
        help="Gallery directory (default: tenant's)",
    )
    gx_parser.add_argument("-v", "--verbose", action="store_true", help="Enable debug logging")
    gx_parser.set_defaults(func=cmd_gallery_index)

    # Locations add command
    la_parser = subparsers.add_parser(
        "locations-add", help="Create a practice location folder for images"
    )
    la_parser.add_argument("--name", "-n", required=True, help="Location name")
    la_parser.add_argument("--tenant", default="colm", help="Tenant slug (default: colm)")
    la_parser.add_argument(
        "--locations-dir",
        default=None,
        help="Locations directory (default: tenant's)",
    )
    la_parser.add_argument("-v", "--verbose", action="store_true", help="Enable debug logging")
    la_parser.set_defaults(func=cmd_locations_add)

    # Locations index command
    lx_parser = subparsers.add_parser(
        "locations-index", help="Regenerate locations/index.json from location folders"
    )
    lx_parser.add_argument("--tenant", default="colm", help="Tenant slug (default: colm)")
    lx_parser.add_argument(
        "--locations-dir",
        default=None,
        help="Locations directory (default: tenant's)",
    )
    lx_parser.add_argument("-v", "--verbose", action="store_true", help="Enable debug logging")
    lx_parser.set_defaults(func=cmd_locations_index)

    # Refresh command (one-shot across all tenants)
    refresh_parser = subparsers.add_parser(
        "refresh", help="One-shot refresh of records + indexes for all tenants (or one)"
    )
    refresh_parser.add_argument(
        "--tenant", default=None, help="Only refresh this tenant slug (default: all)"
    )
    refresh_parser.add_argument(
        "--full",
        action="store_true",
        help="Re-scrape all years from the tenant's records.startYear (default: current year)",
    )
    refresh_parser.add_argument(
        "--skip-scrape",
        action="store_true",
        help="Skip scraping; only rebuild JSON and gallery/locations indexes",
    )
    refresh_parser.add_argument(
        "--courses",
        default="SCY,SCM,LCM",
        help="Comma-separated courses (default: SCY,SCM,LCM)",
    )
    refresh_parser.add_argument(
        "--delay", "-d", type=float, default=2.0, help="Delay between requests (seconds)"
    )
    refresh_parser.add_argument("-v", "--verbose", action="store_true", help="Enable debug logging")
    refresh_parser.set_defaults(func=cmd_refresh)

    # All command (scrape + transform)
    all_parser = subparsers.add_parser("all", help="Scrape and transform in one step")
    all_parser.add_argument("--team", "-t", required=True, help="Team code (e.g., COLM)")
    all_parser.add_argument(
        "--csv-output", default="./output/csv", help="Output directory for CSVs"
    )
    all_parser.add_argument(
        "--json-output", default="./output/json", help="Output directory for JSON"
    )
    all_parser.add_argument(
        "--years",
        "-y",
        default=f"2015-{date.today().year}",
        help="Year range (e.g., 2015-2025) or comma-separated",
    )
    all_parser.add_argument(
        "--courses",
        default="SCY,SCM,LCM",
        help="Comma-separated courses (default: SCY,SCM,LCM)",
    )
    all_parser.add_argument(
        "--lmsc",
        default="55",
        help="LMSC ID (default: 55 for South Carolina)",
    )
    all_parser.add_argument(
        "--delay", "-d", type=float, default=2.0, help="Delay between requests (seconds)"
    )
    all_parser.add_argument("--show-browser", action="store_true", help="Show browser window")
    all_parser.add_argument("--debug-html", action="store_true", help="Save raw HTML for debugging")
    all_parser.add_argument(
        "--firebase", "-f", action="store_true", help="Generate Firebase import format"
    )
    all_parser.add_argument("--ndjson", "-n", action="store_true", help="Generate NDJSON format")
    all_parser.add_argument("--minify", "-m", action="store_true", help="Minify JSON output")
    all_parser.add_argument("-v", "--verbose", action="store_true", help="Enable debug logging")
    all_parser.set_defaults(func=cmd_all)

    args = parser.parse_args()
    setup_logging(args.verbose)

    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
