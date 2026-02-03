"""Transform CSV records to JSON for Firebase."""

import csv
import json
import logging
from pathlib import Path
from typing import Optional

from .models import (
    TeamRecord,
    parse_time_to_seconds,
    normalize_course,
    normalize_gender,
)

logger = logging.getLogger(__name__)


def load_csv(filepath: Path) -> list[dict]:
    """Load records from CSV file."""
    records = []

    with open(filepath, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            records.append(row)

    logger.info(f"Loaded {len(records)} records from {filepath}")
    return records


def transform_record(raw: dict) -> Optional[TeamRecord]:
    """
    Transform a raw CSV row into a TeamRecord.

    Returns None if the record is invalid.
    """
    try:
        # Extract and normalize fields
        team = raw.get("team", "").strip().upper()
        event = raw.get("event", "").strip()
        course = normalize_course(raw.get("course", ""))
        gender = normalize_gender(raw.get("gender", ""))
        age_group = raw.get("age_group", "").strip()
        time_str = raw.get("time", "").strip()
        swimmer = raw.get("swimmer", "").strip()
        date = raw.get("date", "").strip() or None
        meet = raw.get("meet", "").strip() or None
        year = raw.get("year", "").strip() or None

        # Validate required fields
        if not all([team, event, course, gender, age_group, time_str, swimmer]):
            logger.warning(f"Skipping incomplete record: {raw}")
            return None

        # Parse time
        time_in_seconds = parse_time_to_seconds(time_str)
        if time_in_seconds <= 0:
            logger.warning(f"Invalid time '{time_str}' in record: {raw}")
            return None

        return TeamRecord(
            team=team,
            event=event,
            course=course,
            gender=gender,
            age_group=age_group,
            time=time_str,
            time_in_seconds=time_in_seconds,
            swimmer=swimmer,
            date=date,
            meet=meet,
            year=year,
        )

    except Exception as e:
        logger.error(f"Error transforming record {raw}: {e}")
        return None


def transform_csv_to_json(
    csv_path: Path,
    output_path: Optional[Path] = None,
    pretty: bool = True,
) -> list[dict]:
    """
    Transform a CSV file to JSON format for Firebase.

    Args:
        csv_path: Path to input CSV file
        output_path: Path for output JSON file (optional)
        pretty: Whether to format JSON with indentation

    Returns:
        List of transformed records as dictionaries
    """
    raw_records = load_csv(csv_path)

    transformed = []
    for raw in raw_records:
        record = transform_record(raw)
        if record:
            transformed.append(record.to_dict())

    logger.info(f"Transformed {len(transformed)} of {len(raw_records)} records")

    if output_path:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        with open(output_path, "w", encoding="utf-8") as f:
            if pretty:
                json.dump(transformed, f, indent=2)
            else:
                json.dump(transformed, f)
        logger.info(f"Saved JSON to {output_path}")

    return transformed


def transform_multiple_csvs(
    csv_paths: list[Path],
    output_dir: Path,
    combined_output: Optional[Path] = None,
    pretty: bool = True,
) -> dict[str, list[dict]]:
    """
    Transform multiple CSV files to JSON.

    Args:
        csv_paths: List of CSV file paths
        output_dir: Directory for individual JSON outputs
        combined_output: Path for combined JSON file (optional)
        pretty: Whether to format JSON with indentation

    Returns:
        Dictionary mapping filenames to their records
    """
    all_records = {}
    combined = []

    for csv_path in csv_paths:
        json_filename = csv_path.stem + ".json"
        json_path = output_dir / json_filename

        records = transform_csv_to_json(csv_path, json_path, pretty)
        all_records[csv_path.name] = records
        combined.extend(records)

    if combined_output:
        combined_output.parent.mkdir(parents=True, exist_ok=True)
        with open(combined_output, "w", encoding="utf-8") as f:
            if pretty:
                json.dump(combined, f, indent=2)
            else:
                json.dump(combined, f)
        logger.info(f"Saved {len(combined)} combined records to {combined_output}")

    return all_records


def generate_firebase_import(
    records: list[dict],
    output_path: Path,
    collection_name: str = "teamRecords",
) -> None:
    """
    Generate a JSON file formatted for Firebase import.

    For Firestore, this creates a structure like:
    {
        "teamRecords": {
            "COLM_50_free_scy_men_25_29": { ... },
            "COLM_50_free_scy_men_30_34": { ... },
        }
    }

    Args:
        records: List of record dictionaries
        output_path: Path for output file
        collection_name: Firestore collection name
    """
    # Create document-keyed structure
    documents = {}
    for record in records:
        doc_id = record["id"]
        documents[doc_id] = record

    firebase_structure = {collection_name: documents}

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(firebase_structure, f, indent=2)

    logger.info(f"Generated Firebase import file with {len(documents)} documents")


def generate_ndjson(
    records: list[dict],
    output_path: Path,
) -> None:
    """
    Generate newline-delimited JSON (NDJSON) for streaming imports.

    Each line is a separate JSON object, useful for large datasets
    or streaming uploads.

    Args:
        records: List of record dictionaries
        output_path: Path for output file
    """
    output_path.parent.mkdir(parents=True, exist_ok=True)

    with open(output_path, "w", encoding="utf-8") as f:
        for record in records:
            f.write(json.dumps(record) + "\n")

    logger.info(f"Generated NDJSON file with {len(records)} records")
