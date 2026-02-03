"""Data models for USMS records."""

from dataclasses import dataclass, asdict
from typing import Optional
import re


@dataclass
class TeamRecord:
    """A single team record entry."""

    team: str
    event: str
    course: str
    gender: str
    age_group: str
    time: str
    time_in_seconds: float
    swimmer: str
    date: Optional[str] = None
    meet: Optional[str] = None
    year: Optional[str] = None

    @property
    def id(self) -> str:
        """Generate document ID for Firebase."""
        event_slug = self.event.lower().replace(" ", "_").replace("-", "_")
        age_slug = self.age_group.replace("-", "_").replace("+", "plus")
        return f"{self.team}_{event_slug}_{self.course}_{self.gender}_{age_slug}"

    def to_dict(self) -> dict:
        """Convert to dictionary for JSON serialization."""
        d = asdict(self)
        d["id"] = self.id
        # Convert snake_case to camelCase for Firebase
        return {
            "id": self.id,
            "team": self.team,
            "event": self.event,
            "course": self.course,
            "gender": self.gender,
            "ageGroup": self.age_group,
            "time": self.time,
            "timeInSeconds": self.time_in_seconds,
            "swimmer": self.swimmer,
            "date": self.date,
            "meet": self.meet,
            "year": self.year,
        }


def parse_time_to_seconds(time_str: str) -> float:
    """
    Convert swim time string to seconds.

    Handles formats:
    - "22.45" (seconds.hundredths)
    - "1:02.45" (minutes:seconds.hundredths)
    - "10:02.45" (minutes:seconds.hundredths)
    - "1:02:45.67" (hours:minutes:seconds.hundredths) - for distance events
    """
    time_str = time_str.strip()

    # Handle hour:min:sec.hundredths (rare, for very long events)
    if time_str.count(":") == 2:
        match = re.match(r"(\d+):(\d+):(\d+\.?\d*)", time_str)
        if match:
            hours, minutes, seconds = match.groups()
            return int(hours) * 3600 + int(minutes) * 60 + float(seconds)

    # Handle min:sec.hundredths
    if ":" in time_str:
        match = re.match(r"(\d+):(\d+\.?\d*)", time_str)
        if match:
            minutes, seconds = match.groups()
            return int(minutes) * 60 + float(seconds)

    # Just seconds
    try:
        return float(time_str)
    except ValueError:
        return 0.0


def normalize_event_name(event: str) -> str:
    """Normalize event names to consistent format."""
    event = event.strip().lower()

    # Common replacements
    replacements = {
        "free": "free",
        "freestyle": "free",
        "back": "back",
        "backstroke": "back",
        "breast": "breast",
        "breaststroke": "breast",
        "fly": "fly",
        "butterfly": "fly",
        "im": "im",
        "individual medley": "im",
        "medley": "medley",
    }

    for old, new in replacements.items():
        event = event.replace(old, new)

    # Remove extra spaces
    event = "_".join(event.split())

    return event


def normalize_course(course: str) -> str:
    """Normalize course codes."""
    course = course.strip().upper()

    mappings = {
        "SCY": "scy",
        "SHORT COURSE YARDS": "scy",
        "YARDS": "scy",
        "Y": "scy",
        "SCM": "scm",
        "SHORT COURSE METERS": "scm",
        "LCM": "lcm",
        "LONG COURSE METERS": "lcm",
        "LONG COURSE": "lcm",
        "LC": "lcm",
    }

    return mappings.get(course, course.lower())


def normalize_gender(gender: str) -> str:
    """Normalize gender to 'men' or 'women'."""
    gender = gender.strip().lower()

    if gender in ("m", "male", "men", "man"):
        return "men"
    elif gender in ("f", "female", "women", "woman", "w"):
        return "women"

    return gender
