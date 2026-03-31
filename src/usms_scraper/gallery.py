"""Gallery management — create event folders and generate the index."""

import json
import logging
import re
from pathlib import Path

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".gif", ".webp", ".avif"}


def slugify(name: str, date: str = "") -> str:
    """Create a URL-safe slug from event name and optional date prefix."""
    prefix = date if date else ""
    raw = f"{prefix}-{name}" if prefix else name
    slug = re.sub(r"[^a-z0-9]+", "-", raw.lower()).strip("-")
    return slug


def create_event_folder(
    gallery_dir: Path,
    name: str,
    date: str = "",
    description: str = "",
    event_type: str = "meet",
    course: str = "",
) -> Path:
    """Create a gallery event folder with meta.json. Returns the folder path."""
    slug = slugify(name, date)
    folder = gallery_dir / slug
    folder.mkdir(parents=True, exist_ok=True)

    meta_path = folder / "meta.json"
    if meta_path.exists():
        logging.info(f"  Exists: {slug}/")
        return folder

    meta = {
        "name": name,
        "date": date,
        "description": description,
        "type": event_type,
        "course": course.lower(),
        "captions": {},
    }
    with open(meta_path, "w", encoding="utf-8") as f:
        json.dump(meta, f, indent=2, ensure_ascii=False)
        f.write("\n")

    logging.info(f"  Created: {slug}/")
    return folder


def init_from_records(gallery_dir: Path, csv_dir: Path) -> list[Path]:
    """Scan CSVs for unique meets and create a gallery folder for each."""
    import csv as csv_mod

    meets: dict[str, dict] = {}

    for csv_path in sorted(csv_dir.glob("*.csv")):
        with open(csv_path, newline="", encoding="utf-8") as f:
            for row in csv_mod.DictReader(f):
                meet = row.get("meet", "").strip()
                if not meet or meet in meets:
                    continue
                meets[meet] = {
                    "date": row.get("date", ""),
                    "course": row.get("course", ""),
                }

    created = []
    for meet, info in sorted(meets.items()):
        folder = create_event_folder(
            gallery_dir,
            name=meet,
            date=info["date"],
            event_type="meet",
            course=info["course"],
        )
        created.append(folder)

    return created


def build_index(gallery_dir: Path) -> dict:
    """Scan all event folders and generate the gallery index."""
    events = []

    for meta_path in sorted(gallery_dir.glob("*/meta.json")):
        folder = meta_path.parent
        slug = folder.name

        with open(meta_path, encoding="utf-8") as f:
            meta = json.load(f)

        captions = meta.get("captions", {})

        photos = []
        for img in sorted(folder.iterdir()):
            if img.suffix.lower() in IMAGE_EXTENSIONS:
                photos.append({
                    "file": img.name,
                    "caption": captions.get(img.name, ""),
                })

        if not photos:
            continue

        events.append({
            "slug": slug,
            "name": meta.get("name", slug),
            "date": meta.get("date", ""),
            "description": meta.get("description", ""),
            "type": meta.get("type", "meet"),
            "course": meta.get("course", ""),
            "photos": photos,
        })

    # Sort by date descending (newest first), then by name
    events.sort(key=lambda e: (e["date"] or "0000", e["name"]), reverse=True)

    return {"events": events}
