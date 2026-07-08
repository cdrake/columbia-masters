"""Tenant registry: one club per directory under tenants/<slug>/."""

import json
import logging
from dataclasses import dataclass
from pathlib import Path

TENANTS_DIR = Path("tenants")


@dataclass
class Tenant:
    """A club loaded from tenants/<slug>/tenant.json."""

    slug: str
    team_code: str
    lmsc_id: str
    lmsc_name: str
    name: str
    domain: str
    start_year: int
    root: Path
    raw: dict

    @property
    def public_dir(self) -> Path:
        return self.root / "public"

    @property
    def web_data_dir(self) -> Path:
        return self.public_dir / "data"

    @property
    def gallery_dir(self) -> Path:
        return self.public_dir / "gallery"

    @property
    def locations_dir(self) -> Path:
        return self.public_dir / "locations"

    @property
    def csv_dir(self) -> Path:
        return Path("data") / "csv" / self.slug

    @property
    def json_dir(self) -> Path:
        return Path("data") / "json" / self.slug


def load_tenant(slug: str, tenants_dir: Path = TENANTS_DIR) -> Tenant:
    """Load a single tenant by slug. Raises FileNotFoundError/KeyError on bad config."""
    config_path = tenants_dir / slug / "tenant.json"
    if not config_path.exists():
        raise FileNotFoundError(f"No tenant config at {config_path}")
    with open(config_path, encoding="utf-8") as f:
        raw = json.load(f)
    return Tenant(
        slug=raw["slug"],
        team_code=raw["teamCode"],
        lmsc_id=str(raw["lmscId"]),
        lmsc_name=raw["lmscName"],
        name=raw["name"],
        domain=raw["domain"],
        start_year=int(raw.get("records", {}).get("startYear", 2015)),
        root=config_path.parent,
        raw=raw,
    )


def load_tenants(tenants_dir: Path = TENANTS_DIR) -> list[Tenant]:
    """Load every tenant with a tenant.json, sorted by slug. Skips _template."""
    if not tenants_dir.exists():
        return []
    tenants = []
    for config_path in sorted(tenants_dir.glob("*/tenant.json")):
        slug = config_path.parent.name
        if slug.startswith("_"):
            continue
        try:
            tenants.append(load_tenant(slug, tenants_dir))
        except (KeyError, ValueError, json.JSONDecodeError) as e:
            logging.error(f"Skipping tenant {slug}: invalid tenant.json ({e})")
    return tenants
