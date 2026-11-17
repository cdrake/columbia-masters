"""EXPERIMENTAL: ingest SwimJSON meet results into the records CSVs.

SwimJSON (https://swimjson.org, by OpenLane) is a proposed open JSON format for swim meet
data. Meet hosts already produce Hy-Tek/Lenex result files; OpenLane's converter turns
those into SwimJSON. Reading SwimJSON here lets club and state records update from the
meet files themselves instead of from the USMS website, which moved results behind a
login on Nov 10, 2026.

The SwimJSON specification and schema are not published yet ("coming soon"). This module
is written against the example fragments on swimjson.org and is deliberately tolerant:
everything it assumes about the document layout is marked ASSUMPTION and listed in
SWIMJSON.md, so it can be checked against the real schema once it is out.

Output rows use the same columns as the scraper (scraper.RECORD_FIELDS), so the existing
publish path (`publish` for clubs, `refresh --skip-scrape` for state sites) picks them up
unchanged.
"""

from __future__ import annotations

import json
import logging
import re
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path
from typing import Any, Iterable

from .models import parse_time_to_seconds

logger = logging.getLogger(__name__)

# SwimJSON stroke codes -> the event names USMS (and our CSVs) use. Only FREE is shown on
# swimjson.org; the others follow Lenex, which SwimJSON converts to and from. ASSUMPTION.
STROKES = {
    "FREE": "Freestyle",
    "BACK": "Backstroke",
    "BREAST": "Breaststroke",
    "FLY": "Butterfly",
    "IM": "Individual Medley",
    "MEDLEY": "Individual Medley",
}
COURSES = {"SCY": "Y", "SCM": "M", "LCM": "M"}
# Result/event statuses that make a swim count. Only VALID/OFFICIAL appear on swimjson.org.
COUNTING_STATUSES = {"", "VALID", "OFFICIAL", "OK"}
SKIPPED_EVENT_TYPES = {"EXHIBITION", "TIMETRIAL", "TIME_TRIAL", "SWIMOFF", "SWIM_OFF"}
MASTERS_AGE_GROUPS = [(18, 24)] + [(a, a + 4) for a in range(25, 100, 5)]
TOP_N = 10


@dataclass
class IngestReport:
    """What happened to each result in a document, for logging and tests."""

    rows: list[dict] = field(default_factory=list)
    skipped: dict[str, int] = field(default_factory=lambda: defaultdict(int))

    def skip(self, reason: str) -> None:
        self.skipped[reason] += 1


# ---------------------------------------------------------------- document access helpers


def load_document(path: Path) -> dict:
    with open(path, encoding="utf-8") as f:
        doc = json.load(f)
    if not isinstance(doc, dict):
        raise ValueError(f"{path}: expected a JSON object at the top level")
    return doc


def _first(obj: dict, *keys: str, default: Any = None) -> Any:
    for key in keys:
        value = obj.get(key)
        if value not in (None, ""):
            return value
    return default


def _collection(doc: dict, name: str) -> list[dict]:
    """ASSUMPTION: entities sit in top-level arrays (doc["events"]) or under doc["meet"]."""
    for holder in (doc, doc.get("meet") or {}):
        items = holder.get(name)
        if isinstance(items, list):
            return items
        if isinstance(items, dict):  # keyed by id
            return [{"id": k, **v} for k, v in items.items()]
    # Events may also be nested in sessions (events carry a sessionId on swimjson.org).
    if name == "events":
        sessions = _collection(doc, "sessions")
        return [ev for s in sessions for ev in s.get("events", [])]
    return []


def _by_id(items: Iterable[dict]) -> dict[str, dict]:
    return {str(item["id"]): item for item in items if "id" in item}


def _meet_info(doc: dict) -> tuple[str, date | None]:
    meet = doc.get("meet") or {}
    name = _first(meet, "name", "title", default="") or _first(doc, "name", default="")
    end = _first(meet, "endDate", "dateTo", "date", "startDate", "dateFrom")
    return str(name).strip(), _parse_date(end)


def _parse_date(value: Any) -> date | None:
    if not value:
        return None
    try:
        return date.fromisoformat(str(value)[:10])
    except ValueError:
        return None


# ------------------------------------------------------------------- field conversions


def event_name(distance: Any, stroke: Any, course: str) -> str | None:
    stroke_name = STROKES.get(str(stroke or "").upper())
    unit = COURSES.get(course)
    try:
        meters = int(distance)
    except (TypeError, ValueError):
        return None
    if not stroke_name or not unit:
        return None
    return f"{meters} {unit} {stroke_name}"


def season_year(course: str, swum: date) -> int:
    """USMS top-times season a swim counts toward.

    LCM and SCM seasons are calendar years. The SCY season runs June 1 to May 31 and is
    named for the year it ends (our crawl CSVs list an October 2025 meet under SCY 2026).
    """
    if course == "SCY" and swum.month >= 6:
        return swum.year + 1
    return swum.year


def usms_age(course: str, birth: date | None, birth_year: int | None, swum: date) -> int | None:
    """USMS racing age: SCY uses age on the day of the swim; SCM/LCM use age on Dec 31."""
    if course in ("SCM", "LCM"):
        if birth_year:
            return swum.year - birth_year
        return None
    if birth:
        return swum.year - birth.year - ((swum.month, swum.day) < (birth.month, birth.day))
    return None  # SCY needs a full birth date


def age_group_for(age: int) -> str | None:
    for lo, hi in MASTERS_AGE_GROUPS:
        if lo <= age <= hi:
            return f"{lo}-{hi}"
    return None


def _age_group_from_event(event: dict, result: dict, entry: dict | None) -> str | None:
    """Use the event's ageGroups when the result or entry points at one (ageGroupId)."""
    gid = _first(result, "ageGroupId") or (entry and _first(entry, "ageGroupId"))
    groups = event.get("ageGroups") or []
    match = [g for g in groups if str(g.get("id")) == str(gid)] if gid else []
    if not match and len(groups) == 1:
        match = groups
    for g in match:
        lo, hi = g.get("min"), g.get("max")
        if isinstance(lo, int) and isinstance(hi, int) and lo >= 18:
            label = f"{lo}-{hi}"
            if label in {f"{a}-{b}" for a, b in MASTERS_AGE_GROUPS}:
                return label
    return None


def usms_swimmer_id(athlete: dict) -> str:
    """Our swimmer_id is the last 5 characters of the USMS registration (555D-B53P8 -> B53P8).

    ASSUMPTION: the registration number is in athlete.usmsId / registration / license, or in
    an ext/ids map keyed "usms".
    """
    candidates = [_first(athlete, "usmsId", "registration", "registrationId", "license")]
    for holder in ("ids", "externalIds", "ext"):
        mapping = athlete.get(holder)
        if isinstance(mapping, dict):
            candidates.append(_first(mapping, "usms", "USMS"))
    for value in candidates:
        if value:
            tail = re.sub(r"[^A-Za-z0-9]", "", str(value).split("-")[-1])
            if tail:
                return tail[-5:].upper()
    return ""


def athlete_name(athlete: dict) -> str:
    full = _first(athlete, "name", "fullName")
    if full:
        return str(full).strip()
    parts = [_first(athlete, "firstName", "givenName"), _first(athlete, "middleName")]
    parts.append(_first(athlete, "lastName", "familyName"))
    return " ".join(str(p).strip() for p in parts if p)


def _gender(event: dict, athlete: dict) -> str | None:
    sex = str(_first(event, "sex", "gender", default="")).upper()
    if sex not in ("F", "M", "W"):  # X = mixed/combined event: use the athlete's sex
        sex = str(_first(athlete, "sex", "gender", default="")).upper()[:1]
    return {"F": "W", "W": "W", "M": "M"}.get(sex)


def _club_code(athlete: dict, clubs: dict[str, dict]) -> str:
    club = clubs.get(str(_first(athlete, "clubId", default=""))) or {}
    code = _first(club, "code", "abbreviation", "shortName") or _first(athlete, "clubCode")
    return str(code or "").strip().upper()


# ------------------------------------------------------------------------- conversion


def document_to_rows(doc: dict, source: str = "") -> IngestReport:
    """Turn every countable individual swim in a SwimJSON document into a record CSV row.

    Rows have an empty rank; merge_top_n() ranks them against the existing CSV.
    """
    report = IngestReport()
    meet_name, meet_end = _meet_info(doc)
    events = _by_id(_collection(doc, "events"))
    athletes = _by_id(_collection(doc, "athletes"))
    clubs = _by_id(_collection(doc, "clubs"))
    entries = _by_id(_collection(doc, "entries"))
    meet_course = str(_first(doc.get("meet") or {}, "course", default="")).upper()

    for result in _collection(doc, "results"):
        if result.get("relayId") or result.get("relayLegs"):
            report.skip("relay")
            continue
        event = events.get(str(result.get("eventId")))
        if not event:
            report.skip("unknown event")
            continue
        if str(event.get("eventType", "")).upper() in SKIPPED_EVENT_TYPES:
            report.skip("exhibition/time trial")
            continue
        status = str(result.get("status", "")).upper()
        if status not in COUNTING_STATUSES:
            report.skip(f"status {status}")
            continue
        time_str = str(_first(result, "officialTime", "swimTime", "time", default="")).strip()
        if not time_str or parse_time_to_seconds(time_str) <= 0:
            report.skip("no official time")
            continue
        course = str(_first(result, "course", default="") or event.get("course") or meet_course)
        course = course.upper()
        name = event_name(event.get("distance"), event.get("stroke"), course)
        if not name:
            report.skip("unsupported event/course")
            continue
        athlete = athletes.get(str(result.get("athleteId")), {})
        swimmer = athlete_name(athlete)
        gender = _gender(event, athlete)
        team = _club_code(athlete, clubs)
        swum = _parse_date(result.get("date")) or meet_end
        if not (swimmer and gender and team and swum):
            report.skip("missing athlete, sex, club, or date")
            continue

        entry = entries.get(str(result.get("entryId"))) if result.get("entryId") else None
        explicit_age = _first(result, "age") or (entry and _first(entry, "age"))
        birth = _parse_date(athlete.get("birthDate"))
        raw_year = athlete.get("birthYear") or (str(athlete.get("birthDate") or "")[:4] or None)
        birth_year = int(raw_year) if str(raw_year or "").isdigit() else None
        age = int(explicit_age) if explicit_age else usms_age(course, birth, birth_year, swum)
        group = age_group_for(age) if age is not None else None
        group = group or _age_group_from_event(event, result, entry)
        if not group:
            report.skip("no masters age group")
            continue

        report.rows.append(
            {
                "team": team,
                "event": name,
                "course": course,
                "gender": gender,
                "age_group": group,
                "time": time_str,
                "swimmer": swimmer,
                "date": swum.isoformat(),
                "meet": meet_name,
                "year": str(season_year(course, swum)),
                "rank": "",
                "swimmer_id": usms_swimmer_id(athlete),
            }
        )
    if source:
        logger.info(
            f"  {source}: {len(report.rows)} individual swim(s)"
            + (f", skipped {dict(report.skipped)}" if report.skipped else "")
        )
    return report


# ---------------------------------------------------------------------------- merging


def _slot(row: dict, by_team: bool = True) -> tuple:
    key = (row["event"], row["course"].upper(), row["gender"], row["age_group"])
    return (row["team"], *key) if by_team else key


def _same_swim(a: dict, b: dict) -> bool:
    """The same swim seen twice (USMS crawl and a meet file, or a file ingested twice)."""
    who_a = a.get("swimmer_id") or a["swimmer"].lower()
    who_b = b.get("swimmer_id") or b["swimmer"].lower()
    return who_a == who_b and parse_time_to_seconds(a["time"]) == parse_time_to_seconds(b["time"])


def merge_top_n(
    existing: list[dict], incoming: list[dict], n: int = TOP_N, by_team: bool = True
) -> list[dict]:
    """Merge swims into a top-N-per-slot table and re-rank by time.

    Slots are event+course+gender+age group, per club when by_team (club CSVs) or across
    clubs when not (an LMSC's state top 10), matching the USMS top-10 pages: one row per
    swimmer in each slot (their best), ties share a rank, at most n ranks kept.
    """
    slots: dict[tuple, list[dict]] = defaultdict(list)
    for row in existing:
        slots[_slot(row, by_team)].append(dict(row))
    for row in incoming:
        bucket = slots[_slot(row, by_team)]
        if any(_same_swim(row, other) for other in bucket):
            continue
        bucket.append(dict(row))

    merged: list[dict] = []
    for _, rows in sorted(slots.items()):
        best: dict[str, dict] = {}
        for row in rows:
            who = row.get("swimmer_id") or row["swimmer"].lower()
            if who not in best or _secs(row) < _secs(best[who]):
                best[who] = row
        ranked = sorted(best.values(), key=_secs)
        rank, prev = 0, None
        for i, row in enumerate(ranked, start=1):
            if _secs(row) != prev:
                rank, prev = i, _secs(row)
            if rank > n:
                break
            row["rank"] = str(rank)
            merged.append(row)
    return merged


def _secs(row: dict) -> float:
    return parse_time_to_seconds(row["time"])


def group_by_file(rows: Iterable[dict]) -> dict[tuple[str, int], list[dict]]:
    """Group rows by (course, season) so each lands in its season's CSV."""
    groups: dict[tuple[str, int], list[dict]] = defaultdict(list)
    for row in rows:
        groups[(row["course"].upper(), int(row["year"]))].append(row)
    return groups
