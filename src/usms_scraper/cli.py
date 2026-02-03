"""Command-line interface for USMS scraper."""

import argparse
import csv
import logging
import shutil
import sys
from datetime import date
from pathlib import Path

from .scraper import scrape_team_records, ScraperConfig, USMSScraper
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


def cmd_update(args: argparse.Namespace) -> int:
    """Scrape the current year and only update CSVs when new or changed records are found."""
    current_year = date.today().year
    output_dir = Path(args.output)
    courses = [c.strip().upper() for c in args.courses.split(",")]

    logging.info(f"Updating {args.team} records for {current_year} ({', '.join(courses)})")

    try:
        config = ScraperConfig(
            team_code=args.team,
            output_dir=output_dir,
            lmsc_id=args.lmsc,
            years=[current_year],
            courses=courses,
            delay_between_requests=args.delay,
            headless=not args.show_browser,
            save_debug_html=args.debug_html,
        )
        scraper = USMSScraper(config)
        scraped = scraper.scrape_all_raw()

        any_changes = False

        for (year, course), new_records in scraped.items():
            csv_path = output_dir / f"{args.team}_{course.lower()}_{year}_records.csv"
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

        if not any_changes:
            logging.info("No changes detected — data is up to date.")
            return 0

        # Transform all CSVs to JSON
        logging.info("Running transform...")
        csv_files = list(output_dir.glob("*.csv"))
        json_output = Path(args.json_output)
        json_output.mkdir(parents=True, exist_ok=True)

        combined_path = json_output / f"{args.team}_all_records.json"
        all_records = transform_multiple_csvs(
            csv_paths=csv_files,
            output_dir=json_output,
            combined_output=combined_path,
            pretty=True,
        )

        combined_records = []
        for records in all_records.values():
            combined_records.extend(records)

        if args.firebase:
            firebase_path = json_output / f"{args.team}_firebase_import.json"
            generate_firebase_import(combined_records, firebase_path)
            logging.info(f"  Firebase import: {firebase_path}")

        logging.info(f"  Transform complete. Output in {json_output}")

        # Copy combined JSON to web public data directory
        web_data_dir = Path(args.web_data)
        web_data_dir.mkdir(parents=True, exist_ok=True)
        dest = web_data_dir / combined_path.name
        shutil.copy2(combined_path, dest)
        logging.info(f"  Updated website data: {dest}")

        return 0

    except Exception as e:
        logging.error(f"Update failed: {e}")
        return 1


def cmd_publish(args: argparse.Namespace) -> int:
    """Transform existing CSVs and copy JSON to the web public data directory."""
    csv_dir = Path(args.csv_input)
    json_output = Path(args.json_output)
    web_data_dir = Path(args.web_data)

    csv_files = list(csv_dir.glob("*.csv"))
    if not csv_files:
        logging.error(f"No CSV files found in {csv_dir}")
        return 1

    logging.info(f"Transforming {len(csv_files)} CSV file(s)...")
    json_output.mkdir(parents=True, exist_ok=True)

    combined_path = json_output / f"{args.team}_all_records.json"
    all_records = transform_multiple_csvs(
        csv_paths=csv_files,
        output_dir=json_output,
        combined_output=combined_path,
        pretty=True,
    )

    combined_records = []
    for records in all_records.values():
        combined_records.extend(records)

    if args.firebase:
        firebase_path = json_output / f"{args.team}_firebase_import.json"
        generate_firebase_import(combined_records, firebase_path)
        logging.info(f"  Firebase import: {firebase_path}")

    logging.info(f"  Transform complete. Output in {json_output}")

    web_data_dir.mkdir(parents=True, exist_ok=True)
    dest = web_data_dir / combined_path.name
    shutil.copy2(combined_path, dest)
    logging.info(f"  Updated website data: {dest}")
    logging.info(f"  Total records: {len(combined_records)}")

    return 0


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
    update_parser.add_argument("--team", "-t", required=True, help="Team code (e.g., COLM)")
    update_parser.add_argument(
        "--output", "-o", default="./data/csv", help="Output directory for CSVs"
    )
    update_parser.add_argument(
        "--courses",
        default="SCY,SCM,LCM",
        help="Comma-separated courses (default: SCY,SCM,LCM)",
    )
    update_parser.add_argument(
        "--lmsc",
        default="55",
        help="LMSC ID (default: 55 for South Carolina)",
    )
    update_parser.add_argument(
        "--delay", "-d", type=float, default=2.0, help="Delay between requests (seconds)"
    )
    update_parser.add_argument("--show-browser", action="store_true", help="Show browser window")
    update_parser.add_argument(
        "--debug-html", action="store_true", help="Save raw HTML for debugging"
    )
    update_parser.add_argument(
        "--json-output", default="./data/json", help="Output directory for JSON"
    )
    update_parser.add_argument(
        "--web-data",
        default="./web/public/data",
        help="Web public data directory for website JSON (default: ./web/public/data)",
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
    publish_parser.add_argument("--team", "-t", required=True, help="Team code (e.g., COLM)")
    publish_parser.add_argument(
        "--csv-input", default="./data/csv", help="Directory containing CSV files"
    )
    publish_parser.add_argument(
        "--json-output", default="./data/json", help="Output directory for JSON"
    )
    publish_parser.add_argument(
        "--web-data",
        default="./web/public/data",
        help="Web public data directory (default: ./web/public/data)",
    )
    publish_parser.add_argument(
        "--firebase", "-f", action="store_true", help="Generate Firebase import format"
    )
    publish_parser.add_argument("-v", "--verbose", action="store_true", help="Enable debug logging")
    publish_parser.set_defaults(func=cmd_publish)

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
