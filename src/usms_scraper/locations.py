"""Location image management — discover images per practice location and build an index."""

import json
import logging
from pathlib import Path

from .gallery import IMAGE_EXTENSIONS, slugify


def create_location_folder(locations_dir: Path, name: str) -> Path:
    """Create a location folder with meta.json. Returns the folder path."""
    slug = slugify(name)
    folder = locations_dir / slug
    folder.mkdir(parents=True, exist_ok=True)

    meta_path = folder / "meta.json"
    if not meta_path.exists():
        meta = {"name": name, "captions": {}}
        with open(meta_path, "w", encoding="utf-8") as f:
            json.dump(meta, f, indent=2, ensure_ascii=False)
            f.write("\n")
        logging.info(f"  Created: {slug}/")
    return folder


def build_index(locations_dir: Path) -> dict:
    """Scan all location folders and generate the locations index."""
    locations = []

    for meta_path in sorted(locations_dir.glob("*/meta.json")):
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

        locations.append({
            "slug": slug,
            "name": meta.get("name", slug),
            "photos": photos,
        })

    locations.sort(key=lambda loc: loc["name"])
    return {"locations": locations}
