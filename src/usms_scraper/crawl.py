"""Paced, resumable crawl of USMS local top-10 listings for every LMSC and every club.

The USMS "Top 10 Times for LMSC/Club" page (toptenlocalind.php) answers plain GET
requests once the Azure WAF JavaScript challenge has been passed, so this crawler drives
a headless Chrome straight to result URLs instead of filling in the form each time.

The crawl runs in two phases:

1. **LMSC listings** - one request per (LMSC, year, course) with the club field blank.
   The LMSC-wide top 10 is saved and every club code seen on a line is recorded.
2. **Club listings** - one request per (LMSC, year, course, club) for every club that
   was seen in that LMSC within ``club_window`` years of the target year. The per-club
   rows for one (LMSC, year, course) are combined into a single CSV.

Progress is checkpointed after every unit of work in a JSON state file, so the crawl can
be spread across many short runs (a cron job) and resumed after any failure. Each run
computes a request budget from how much work is left and how many runs remain before the
deadline, which is what spreads the whole crawl evenly over the requested number of days.
"""

from __future__ import annotations

import json
import logging
import math
import time
from dataclasses import dataclass, field, asdict
from datetime import date, datetime, timedelta
from pathlib import Path
from urllib.parse import urlencode

from selenium.webdriver.common.by import By
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import WebDriverWait
from selenium.common.exceptions import TimeoutException, WebDriverException
from urllib3.exceptions import ReadTimeoutError

from .scraper import create_driver, parse_top_ten_html, write_records_csv

logger = logging.getLogger(__name__)

RESULTS_URL = "https://www.usms.org/comp/meets/toptenlocalind.php"

# CourseID values used by the USMS form.
COURSE_IDS = {"SCY": "1", "LCM": "2", "SCM": "3"}

# Every LMSC offered by the toptenlocal.php form (LMSCID -> name).
LMSCS: dict[str, str] = {
    "3": "Adirondack",
    "56": "Alaska",
    "11": "Allegheny Mountain",
    "48": "Arizona",
    "23": "Arkansas",
    "32": "Colorado",
    "5": "Connecticut",
    "8": "Delaware Valley",
    "14": "Florida",
    "50": "Florida Gold Coast",
    "45": "Georgia",
    "25": "Gulf",
    "39": "Hawaii",
    "21": "Illinois",
    "16": "Indiana",
    "35": "Inland Northwest",
    "40": "Iowa",
    "41": "Kentucky",
    "18": "Lake Erie",
    "9": "Maryland",
    "6": "Metropolitan",
    "19": "Michigan",
    "30": "Minnesota",
    "28": "Missouri Valley",
    "31": "Montana",
    "29": "Nebraska",
    "2": "New England",
    "7": "New Jersey",
    "42": "New Mexico",
    "4": "Niagara",
    "13": "North Carolina",
    "52": "North Dakota",
    "26": "North Texas",
    "17": "Ohio",
    "27": "Oklahoma",
    "37": "Oregon",
    "22": "Ozark",
    "38": "Pacific",
    "36": "Pacific Northwest",
    "10": "Potomac Valley",
    "44": "San Diego - Imperial",
    "59": "Snake River",
    "55": "South Carolina",
    "54": "South Dakota",
    "43": "South Texas",
    "15": "Southeastern",
    "24": "Southern",
    "33": "Southern Pacific",
    "34": "Utah",
    "12": "Virginia",
    "20": "Wisconsin",
}

# The USMS results database has no local top-10 data before this year.
DEFAULT_START_YEAR = 2000

# Average clubs per LMSC, used to estimate phase-2 work before phase 1 has run.
_CLUB_ESTIMATE = 20


def results_url(year: int, course: str, lmsc_id: str, club: str = "") -> str:
    """Build the GET URL the USMS form submits to."""
    query = {
        "Year": year,
        "CourseID": COURSE_IDS[course],
        "ZoneID": "",
        "LMSCID": lmsc_id,
        "Club": club,
    }
    return f"{RESULTS_URL}?{urlencode(query)}"


def unit_key(lmsc_id: str, year: int, course: str) -> str:
    return f"{lmsc_id}:{year}:{course}"


def parse_unit_key(key: str) -> tuple[str, int, str]:
    lmsc_id, year, course = key.split(":")
    return lmsc_id, int(year), course


class CrawlBlockedError(RuntimeError):
    """Raised when usms.org keeps refusing to serve results (WAF challenge, outage)."""


@dataclass
class CrawlState:
    """Checkpoint for one crawl, persisted as JSON after every unit of work."""

    started: str
    deadline: str
    days: int
    runs_per_day: int
    start_year: int
    end_year: int
    courses: list[str]
    lmscs: list[str]
    club_window: int
    phase1_done: list[str] = field(default_factory=list)
    phase2_done: list[str] = field(default_factory=list)
    # lmsc_id -> club code -> sorted list of years the club appeared in an LMSC listing
    clubs: dict[str, dict[str, list[int]]] = field(default_factory=dict)
    failures: dict[str, int] = field(default_factory=dict)
    requests_made: int = 0
    runs: int = 0
    last_run: str | None = None
    finished: str | None = None

    # ------------------------------------------------------------------ persistence

    @classmethod
    def load(cls, path: Path) -> CrawlState:
        with open(path, encoding="utf-8") as f:
            raw = json.load(f)
        return cls(**raw)

    def save(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".tmp")
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(asdict(self), f, indent=2)
        tmp.replace(path)

    @classmethod
    def new(
        cls,
        days: int,
        runs_per_day: int,
        start_year: int,
        end_year: int,
        courses: list[str],
        lmscs: list[str],
        club_window: int,
        now: datetime | None = None,
    ) -> CrawlState:
        now = now or datetime.now()
        return cls(
            started=now.isoformat(timespec="seconds"),
            deadline=(now + timedelta(days=days)).isoformat(timespec="seconds"),
            days=days,
            runs_per_day=runs_per_day,
            start_year=start_year,
            end_year=end_year,
            courses=courses,
            lmscs=lmscs,
            club_window=club_window,
        )

    # ------------------------------------------------------------------ work units

    @property
    def years(self) -> list[int]:
        return list(range(self.start_year, self.end_year + 1))

    def all_units(self) -> list[str]:
        """Every (lmsc, year, course) unit, LMSC-major so one LMSC completes at a time."""
        return [
            unit_key(lmsc, year, course)
            for lmsc in self.lmscs
            for year in self.years
            for course in self.courses
        ]

    def phase1_complete(self, lmsc_id: str) -> bool:
        done = set(self.phase1_done)
        return all(unit_key(lmsc_id, y, c) in done for y in self.years for c in self.courses)

    def clubs_for(self, lmsc_id: str, year: int) -> list[str]:
        """Clubs to query for an LMSC/year: seen in a listing within ``club_window`` years."""
        seen = self.clubs.get(lmsc_id, {})
        if self.club_window < 0:
            return sorted(seen)
        lo, hi = year - self.club_window, year + self.club_window
        return sorted(club for club, years in seen.items() if any(lo <= y <= hi for y in years))

    def record_clubs(self, lmsc_id: str, year: int, clubs: set[str]) -> None:
        bucket = self.clubs.setdefault(lmsc_id, {})
        for club in clubs:
            years = bucket.setdefault(club, [])
            if year not in years:
                years.append(year)
                years.sort()

    def pending_units(self) -> list[tuple[int, str]]:
        """Remaining work as (phase, unit) in execution order: all of phase 1, then phase 2."""
        skip = {u for u, n in self.failures.items() if n >= MAX_UNIT_FAILURES}
        p1_done = set(self.phase1_done)
        p2_done = set(self.phase2_done)
        # Phase 2 needs each LMSC's complete club list, so every phase-1 unit runs first.
        pending = [(1, u) for u in self.all_units() if u not in p1_done and u not in skip]
        pending += [(2, u) for u in self.all_units() if u not in p2_done and u not in skip]
        return pending

    def estimate_requests(self, phase: int, unit: str) -> int:
        lmsc_id, year, _ = parse_unit_key(unit)
        if phase == 1:
            return 1
        if self.phase1_complete(lmsc_id):
            return max(1, len(self.clubs_for(lmsc_id, year)))
        seen = self.clubs.get(lmsc_id)
        return len(seen) if seen else _CLUB_ESTIMATE

    def remaining_requests(self) -> int:
        return sum(self.estimate_requests(p, u) for p, u in self.pending_units())

    def runs_remaining(self, now: datetime | None = None) -> int:
        """How many more scheduled runs (including this one) fit before the deadline."""
        now = now or datetime.now()
        deadline = datetime.fromisoformat(self.deadline)
        hours_left = (deadline - now).total_seconds() / 3600
        if hours_left <= 0:
            return 1
        return max(1, math.ceil(hours_left * self.runs_per_day / 24))

    def budget_for_run(self, now: datetime | None = None) -> int:
        """Requests this run should make so the remaining work is spread to the deadline."""
        remaining = self.remaining_requests()
        return math.ceil(remaining / self.runs_remaining(now))

    def progress(self) -> dict:
        total_units = len(self.all_units())
        return {
            "units_total": total_units,
            "phase1_done": len(self.phase1_done),
            "phase2_done": len(self.phase2_done),
            "lmscs_with_clubs": len(self.clubs),
            "clubs_seen": sum(len(c) for c in self.clubs.values()),
            "requests_made": self.requests_made,
            "requests_remaining_est": self.remaining_requests(),
            "runs_remaining": self.runs_remaining(),
            "failed_units": sorted(u for u, n in self.failures.items() if n >= MAX_UNIT_FAILURES),
            "deadline": self.deadline,
            "finished": self.finished,
        }


MAX_UNIT_FAILURES = 3
MAX_CONSECUTIVE_FAILURES = 5


class UsmsCrawler:
    """Executes crawl units against usms.org with a single browser session."""

    def __init__(
        self,
        state: CrawlState,
        state_path: Path,
        output_dir: Path,
        delay: float = 1.0,
        timeout: int = 45,
        headless: bool = True,
        debug_dir: Path | None = None,
    ):
        self.state = state
        self.state_path = state_path
        self.output_dir = output_dir
        self.delay = delay
        self.timeout = timeout
        self.headless = headless
        self.debug_dir = debug_dir
        self.driver = None

    # ------------------------------------------------------------------ paths

    def lmsc_top10_path(self, lmsc_id: str, year: int, course: str) -> Path:
        return (
            self.output_dir
            / lmsc_id
            / "lmsc_top10"
            / f"{lmsc_id}_{course.lower()}_{year}_top10.csv"
        )

    def club_records_path(self, lmsc_id: str, year: int, course: str) -> Path:
        return self.output_dir / lmsc_id / f"{lmsc_id}_{course.lower()}_{year}_records.csv"

    # ------------------------------------------------------------------ fetching

    def _fetch(self, year: int, course: str, lmsc_id: str, club: str = "") -> list[dict]:
        """Load one results page and parse it. Retries through WAF challenges."""
        url = results_url(year, course, lmsc_id, club)
        last_error: Exception | None = None
        for attempt in range(1, 4):
            try:
                self.driver.get(url)
                WebDriverWait(self.driver, self.timeout).until(
                    EC.presence_of_element_located((By.TAG_NAME, "pre"))
                )
                html = self.driver.page_source
                self.state.requests_made += 1
                return parse_top_ten_html(html, course, year, team_code=club or None)
            except TimeoutException as e:
                last_error = e
                title = ""
                try:
                    title = self.driver.title
                except WebDriverException:
                    pass
                logger.warning(f"  attempt {attempt}: no results block for {url} (title={title!r})")
                self._dump_debug(f"timeout_{lmsc_id}_{year}_{course}_{club or 'lmsc'}_{attempt}")
                time.sleep(5 * attempt)
            except WebDriverException as e:
                last_error = e
                logger.warning(f"  attempt {attempt}: browser error for {url}: {e}")
                time.sleep(5 * attempt)
            except ReadTimeoutError as e:
                # chromedriver hung (no reply in 120s); a fresh browser is the only way out.
                last_error = e
                logger.warning(f"  attempt {attempt}: browser hung on {url}; restarting it")
                self._restart_driver()
            finally:
                time.sleep(self.delay)
        raise CrawlBlockedError(f"Gave up on {url}: {last_error}")

    def _restart_driver(self) -> None:
        try:
            self.driver.quit()
        except Exception:
            pass  # the old session is wedged; abandon it
        self.driver = create_driver(headless=self.headless)

    def _dump_debug(self, label: str) -> None:
        if not self.debug_dir or not self.driver:
            return
        try:
            self.debug_dir.mkdir(parents=True, exist_ok=True)
            (self.debug_dir / f"{label}.html").write_text(self.driver.page_source, encoding="utf-8")
        except Exception:  # debugging must never break the crawl
            pass

    # ------------------------------------------------------------------ units

    def run_phase1(self, unit: str) -> int:
        lmsc_id, year, course = parse_unit_key(unit)
        records = self._fetch(year, course, lmsc_id)
        clubs = {r["team"] for r in records}
        self.state.record_clubs(lmsc_id, year, clubs)
        if records:
            write_records_csv(records, self.lmsc_top10_path(lmsc_id, year, course))
        logger.info(
            f"  [1] {LMSCS.get(lmsc_id, lmsc_id)} {course} {year}: "
            f"{len(records)} LMSC top-10 rows, {len(clubs)} club(s)"
        )
        self.state.phase1_done.append(unit)
        return 1

    def run_phase2(self, unit: str) -> int:
        lmsc_id, year, course = parse_unit_key(unit)
        if not self.state.phase1_complete(lmsc_id):
            logger.warning(
                f"  LMSC {lmsc_id} has unfinished/failed phase-1 units; club list may be partial"
            )
        clubs = self.state.clubs_for(lmsc_id, year)
        combined: list[dict] = []
        for club in clubs:
            combined.extend(self._fetch(year, course, lmsc_id, club))
        if combined:
            write_records_csv(combined, self.club_records_path(lmsc_id, year, course))
        logger.info(
            f"  [2] {LMSCS.get(lmsc_id, lmsc_id)} {course} {year}: "
            f"{len(combined)} club records across {len(clubs)} club(s)"
        )
        self.state.phase2_done.append(unit)
        return len(clubs)

    def run(self, budget: int, max_minutes: float | None = None) -> dict:
        """Execute pending units until the request budget or time limit is spent."""
        started = time.monotonic()
        spent = 0
        units_done = 0
        consecutive_failures = 0
        self.state.runs += 1
        self.state.last_run = datetime.now().isoformat(timespec="seconds")

        def out_of_time() -> bool:
            return max_minutes is not None and (time.monotonic() - started) / 60 >= max_minutes

        try:
            self.driver = create_driver(headless=self.headless)
            logger.info("Browser started.")

            while spent < budget and not out_of_time():
                pending = self.state.pending_units()
                if not pending:
                    self.state.finished = datetime.now().isoformat(timespec="seconds")
                    logger.info("Crawl complete: no pending units.")
                    break
                phase, unit = pending[0]
                try:
                    spent += self.run_phase1(unit) if phase == 1 else self.run_phase2(unit)
                    units_done += 1
                    consecutive_failures = 0
                    self.state.failures.pop(unit, None)
                except CrawlBlockedError as e:
                    consecutive_failures += 1
                    self.state.failures[unit] = self.state.failures.get(unit, 0) + 1
                    logger.error(f"  unit {unit} failed ({self.state.failures[unit]}x): {e}")
                    if consecutive_failures >= MAX_CONSECUTIVE_FAILURES:
                        self.state.save(self.state_path)
                        raise CrawlBlockedError(
                            f"{consecutive_failures} consecutive unit failures; "
                            "usms.org is probably blocking this session"
                        ) from e
                finally:
                    self.state.save(self.state_path)
        finally:
            if self.driver:
                self.driver.quit()
                logger.info("Browser closed.")
            self.state.save(self.state_path)

        return {
            "requests": spent,
            "units": units_done,
            "minutes": round((time.monotonic() - started) / 60, 1),
            "budget": budget,
        }


def write_clubs_index(state: CrawlState, path: Path) -> None:
    """Write a human-friendly summary of every club discovered so far."""
    summary = {
        lmsc_id: {
            "name": LMSCS.get(lmsc_id, lmsc_id),
            "clubs": {
                club: {"firstYear": years[0], "lastYear": years[-1], "years": years}
                for club, years in sorted(state.clubs.get(lmsc_id, {}).items())
            },
        }
        for lmsc_id in state.lmscs
        if state.clubs.get(lmsc_id)
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(
            {"generated": date.today().isoformat(), "lmscs": summary},
            f,
            indent=2,
        )
