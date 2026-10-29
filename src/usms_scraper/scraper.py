"""Scraper for USMS team records via toptenlocal.php using Selenium."""

import csv
import re
import time
import logging
from datetime import date
from pathlib import Path
from dataclasses import dataclass, field

from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import Select, WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.common.exceptions import TimeoutException, NoSuchElementException
from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)

TOP_TEN_LOCAL_URL = "https://www.usms.org/comp/meets/toptenlocal.php"

# Course display text as it appears in the USMS form
COURSE_LABELS = {
    "SCY": "Short Course Yards",
    "SCM": "Short Course Meters",
    "LCM": "Long Course Meters",
}


@dataclass
class ScraperConfig:
    """Configuration for the scraper."""

    team_code: str
    output_dir: Path
    lmsc_id: str = "55"  # South Carolina
    years: list[int] = field(default_factory=lambda: list(range(2015, date.today().year + 1)))
    courses: list[str] = field(default_factory=lambda: ["SCY", "SCM", "LCM"])
    delay_between_requests: float = 2.0
    timeout: int = 30
    headless: bool = True
    save_debug_html: bool = False


# Column order shared by every records CSV this package writes.
RECORD_FIELDS = [
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
    "swimmer_id",
]

# Event header lines inside the <pre> block: <strong><u>Men 45-49 50 Y Freestyle </u></strong>
_EVENT_HEADER_HTML_RE = re.compile(r"<strong><u>(Men|Women)\s+(\d+-\d+)\s+(.+?)\s*</u></strong>")

# Data lines like "  1      26.85 Joshua McDuffie, M48, COLM, 554U-YZFEE,"
# Time can be: 26.85, 1:01.20, 10:01.20, 1:02:45.67
_DATA_LINE_RE = re.compile(
    r"^\s*(\d+)\s+"  # rank
    r"([\d:]+\.\d+)\s+"  # time
    r"(.+?),\s*"  # swimmer name
    r"([MF]\d+),\s*"  # gender+age (e.g. M48)
    r"(\w+),\s*"  # club code
    r"([\w-]+),\s*"  # USMS ID
)

_MEET_LINK_RE = re.compile(r'<a\s+href="[^"]*">([^<]+)</a>')
_TAG_RE = re.compile(r"<[^>]+>")


def create_driver(headless: bool = True) -> webdriver.Chrome:
    """Create a Chrome browser instance configured for usms.org."""
    options = webdriver.ChromeOptions()
    if headless:
        options.add_argument("--headless=new")
    options.add_argument("--no-sandbox")
    options.add_argument("--disable-dev-shm-usage")
    options.add_argument("--disable-gpu")
    options.add_argument(
        "user-agent=Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    )
    return webdriver.Chrome(options=options)


def parse_top_ten_html(
    html: str, course: str, year: int, team_code: str | None = None
) -> list[dict]:
    """Parse a toptenlocalind.php results page into record dicts.

    ``team_code`` fixes the ``team`` column (a single-club query). When it is None the
    club code found on each data line is used instead, which is what an LMSC-wide
    listing needs.
    """
    records: list[dict] = []
    soup = BeautifulSoup(html, "lxml")

    pre = soup.find("pre")
    if not pre:
        logger.warning("No <pre> block found on results page")
        return records

    current_gender = ""
    current_age_group = ""
    current_event = ""

    # Walk the raw HTML line by line so meet names can be pulled from the <a> tags.
    for line in str(pre).split("\n"):
        if not line.strip():
            continue

        header_match = _EVENT_HEADER_HTML_RE.search(line)
        if header_match:
            current_gender = "M" if header_match.group(1) == "Men" else "W"
            current_age_group = header_match.group(2)
            current_event = header_match.group(3).strip()
            continue

        clean_line = _TAG_RE.sub("", line)
        data_match = _DATA_LINE_RE.match(clean_line)
        if not data_match:
            continue

        # Each data line ends with: <a>View</a> | <a>Meet Name</a>
        meet_links = _MEET_LINK_RE.findall(line)
        meet = meet_links[-1].strip() if len(meet_links) >= 2 else ""

        records.append(
            {
                "team": team_code or data_match.group(5),
                "event": current_event,
                "course": course,
                "gender": current_gender,
                "age_group": current_age_group,
                "time": data_match.group(2),
                "swimmer": data_match.group(3).strip(),
                "date": "",
                "meet": meet,
                "year": str(year),
                "rank": data_match.group(1),
                # "554U-YZFEE": the part after the dash is the member's permanent USMS ID.
                "swimmer_id": data_match.group(6).rsplit("-", 1)[-1],
            }
        )

    return records


def write_records_csv(records: list[dict], path: Path) -> None:
    """Write records to a CSV file using the shared column order."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=RECORD_FIELDS)
        writer.writeheader()
        writer.writerows(records)


class USMSScraper:
    """Scraper for USMS team records using Selenium."""

    def __init__(self, config: ScraperConfig):
        self.config = config
        self.driver = None

    def _create_driver(self) -> webdriver.Chrome:
        """Create a headless Chrome browser instance."""
        return create_driver(headless=self.config.headless)

    def scrape_all(self) -> list[Path]:
        """Scrape all records for the configured team across years and courses."""
        output_files = []
        self.config.output_dir.mkdir(parents=True, exist_ok=True)

        try:
            self.driver = self._create_driver()
            logger.info(f"Browser started. Scraping {self.config.team_code} records...")

            for year in self.config.years:
                for course in self.config.courses:
                    logger.info(f"Fetching {course} {year} for {self.config.team_code}...")

                    try:
                        records = self._scrape_year_course(year, course)
                    except Exception as e:
                        logger.error(f"Failed {course} {year}: {e}")
                        continue

                    if records:
                        output_file = self._save_to_csv(records, course, year)
                        output_files.append(output_file)
                        logger.info(f"  Saved {len(records)} records to {output_file.name}")
                    else:
                        logger.info(f"  No records found for {course} {year}")

                    time.sleep(self.config.delay_between_requests)

        finally:
            if self.driver:
                self.driver.quit()
                logger.info("Browser closed.")

        return output_files

    def scrape_all_raw(self) -> dict[tuple[int, str], list[dict]]:
        """Scrape all records and return them grouped by (year, course) without writing files."""
        results: dict[tuple[int, str], list[dict]] = {}

        try:
            self.driver = self._create_driver()
            logger.info(f"Browser started. Scraping {self.config.team_code} records...")

            for year in self.config.years:
                for course in self.config.courses:
                    logger.info(f"Fetching {course} {year} for {self.config.team_code}...")

                    try:
                        records = self._scrape_year_course(year, course)
                    except Exception as e:
                        logger.error(f"Failed {course} {year}: {e}")
                        continue

                    results[(year, course)] = records
                    if records:
                        logger.info(f"  Found {len(records)} records")
                    else:
                        logger.info(f"  No records found for {course} {year}")

                    time.sleep(self.config.delay_between_requests)

        finally:
            if self.driver:
                self.driver.quit()
                logger.info("Browser closed.")

        return results

    def _scrape_year_course(self, year: int, course: str) -> list[dict]:
        """Scrape all records for a given year and course."""
        self.driver.get(TOP_TEN_LOCAL_URL)

        wait = WebDriverWait(self.driver, self.config.timeout)

        # Wait for form to be present — try multiple strategies
        try:
            # Look for any form element or input
            wait.until(EC.presence_of_element_located((By.TAG_NAME, "form")))
        except TimeoutException:
            # If no form tag, wait for any input element
            try:
                wait.until(EC.presence_of_element_located((By.TAG_NAME, "input")))
            except TimeoutException:
                logger.warning("Page did not load form elements")
                self._dump_page_source(f"no_form_{course}_{year}")
                return []

        # Give JS a moment to finish rendering
        time.sleep(1)

        # Debug: dump page to understand structure on first run
        if self.config.save_debug_html:
            self._dump_page_source(f"form_{course}_{year}")

        # Check if the year is available in the dropdown
        available_years = self._get_available_years()
        if available_years is not None and year not in available_years:
            logger.info(f"  Year {year} not available in form (max: {max(available_years)})")
            return []

        # Fill in the form
        try:
            self._fill_form(year, course)
        except Exception as e:
            logger.error(f"Could not fill form for {course} {year}: {e}")
            self._dump_page_source(f"fill_error_{course}_{year}")
            return []

        # Submit and wait for results
        try:
            self._submit_form()
        except Exception as e:
            logger.error(f"Could not submit form for {course} {year}: {e}")
            self._dump_page_source(f"submit_error_{course}_{year}")
            return []

        # Parse results
        return self._parse_results(course, year)

    def _get_available_years(self) -> list[int] | None:
        """Read available years from a <select> dropdown, if present.

        Returns a sorted list of year ints, or None if the year field is not a dropdown.
        """
        for name in ["Year", "year", "YearID", "yearID"]:
            try:
                select = Select(self.driver.find_element(By.NAME, name))
                years = []
                for option in select.options:
                    text = option.text.strip()
                    if text.isdigit():
                        years.append(int(text))
                if years:
                    return sorted(years)
            except (NoSuchElementException, Exception):
                continue
        return None

    def _fill_form(self, year: int, course: str) -> None:
        """Fill in the toptenlocal.php form fields."""
        # Try to find and fill the Year field — prefer <select> dropdown
        year_filled = False

        for name in ["Year", "year", "YearID", "yearID"]:
            try:
                select = Select(self.driver.find_element(By.NAME, name))
                select.select_by_visible_text(str(year))
                year_filled = True
                break
            except (NoSuchElementException, Exception):
                continue

        # Fall back to text input
        if not year_filled:
            for selector in ["input[name='Year']", "input[name='year']", "input[type='text']"]:
                try:
                    year_input = self.driver.find_element(By.CSS_SELECTOR, selector)
                    year_input.clear()
                    year_input.send_keys(str(year))
                    year_filled = True
                    break
                except NoSuchElementException:
                    continue

        if not year_filled:
            # Try finding by label text
            try:
                labels = self.driver.find_elements(By.TAG_NAME, "label")
                for label in labels:
                    if "year" in label.text.lower():
                        input_id = label.get_attribute("for")
                        if input_id:
                            year_input = self.driver.find_element(By.ID, input_id)
                            year_input.clear()
                            year_input.send_keys(str(year))
                            year_filled = True
                            break
            except NoSuchElementException:
                pass

        if not year_filled:
            raise RuntimeError("Could not find Year input field")

        # Select Course
        course_label = COURSE_LABELS[course]
        course_selected = False

        # Try select dropdown
        for name in ["CourseID", "Course", "course", "courseID"]:
            try:
                select = Select(self.driver.find_element(By.NAME, name))
                for option in select.options:
                    if course_label.lower() in option.text.lower() or course in option.text:
                        select.select_by_visible_text(option.text)
                        course_selected = True
                        break
                if course_selected:
                    break
            except (NoSuchElementException, Exception):
                continue

        # Try radio buttons
        if not course_selected:
            radios = self.driver.find_elements(By.CSS_SELECTOR, "input[type='radio']")
            for radio in radios:
                label = radio.find_element(By.XPATH, "..").text
                if course_label.lower() in label.lower() or course in label:
                    radio.click()
                    course_selected = True
                    break

        if not course_selected:
            raise RuntimeError(f"Could not select course: {course}")

        # Select LMSC (South Carolina)
        lmsc_selected = False
        for name in ["LMSCID", "lmscID", "LMSC", "lmsc"]:
            try:
                select = Select(self.driver.find_element(By.NAME, name))
                # Try by value first
                try:
                    select.select_by_value(self.config.lmsc_id)
                    lmsc_selected = True
                    break
                except NoSuchElementException:
                    pass
                # Try by text containing "South Carolina"
                for option in select.options:
                    if "south carolina" in option.text.lower():
                        select.select_by_visible_text(option.text)
                        lmsc_selected = True
                        break
                if lmsc_selected:
                    break
            except (NoSuchElementException, Exception):
                continue

        if not lmsc_selected:
            logger.warning("Could not select LMSC — results may not be filtered properly")

        # Fill Club abbreviation
        for name in ["Club", "club", "ClubAbbr", "clubabbr"]:
            try:
                club_input = self.driver.find_element(By.NAME, name)
                club_input.clear()
                club_input.send_keys(self.config.team_code)
                return
            except NoSuchElementException:
                continue

        # Try finding text inputs near "club" label
        inputs = self.driver.find_elements(By.CSS_SELECTOR, "input[type='text']")
        for inp in inputs:
            placeholder = (inp.get_attribute("placeholder") or "").lower()
            name = (inp.get_attribute("name") or "").lower()
            if "club" in placeholder or "club" in name:
                inp.clear()
                inp.send_keys(self.config.team_code)
                return

        logger.warning("Could not find Club abbreviation field — will get all LMSC results")

    def _submit_form(self) -> None:
        """Submit the form and wait for results."""
        # Try submit button
        for selector in [
            "input[type='submit']",
            "button[type='submit']",
            "input[value='Submit']",
            "input[value='Go']",
            "input[value='Search']",
            "button",
        ]:
            try:
                btn = self.driver.find_element(By.CSS_SELECTOR, selector)
                btn.click()
                # Wait for page to change or results to appear
                time.sleep(3)
                return
            except NoSuchElementException:
                continue

        # Try submitting the form directly via JS
        try:
            forms = self.driver.find_elements(By.TAG_NAME, "form")
            if forms:
                self.driver.execute_script("arguments[0].submit();", forms[0])
                time.sleep(3)
                return
        except Exception:
            pass

        raise RuntimeError("Could not find submit button or form to submit")

    def _parse_results(self, course: str, year: int) -> list[dict]:
        """Parse results from the <pre> block on the results page."""
        time.sleep(2)

        html = self.driver.page_source

        if self.config.save_debug_html:
            self._dump_page_source(f"results_{course}_{year}")

        records = parse_top_ten_html(html, course, year, team_code=self.config.team_code)
        logger.debug(f"Parsed {len(records)} records from {course} {year}")
        return records

    def _save_to_csv(self, records: list[dict], course: str, year: int) -> Path:
        """Save records to CSV file."""
        filename = f"{self.config.team_code}_{course.lower()}_{year}_records.csv"
        filepath = self.config.output_dir / filename
        write_records_csv(records, filepath)
        return filepath

    def _dump_page_source(self, label: str) -> None:
        """Save current page HTML for debugging."""
        debug_dir = self.config.output_dir / "debug"
        debug_dir.mkdir(parents=True, exist_ok=True)
        path = debug_dir / f"{label}.html"
        with open(path, "w", encoding="utf-8") as f:
            f.write(self.driver.page_source)
        logger.debug(f"Saved debug HTML to {path}")


def scrape_team_records(
    team_code: str,
    output_dir: Path,
    lmsc_id: str = "55",
    years: list[int] | None = None,
    courses: list[str] | None = None,
    delay: float = 2.0,
    headless: bool = True,
    save_debug_html: bool = False,
) -> list[Path]:
    """
    Main entry point for scraping team records.

    Args:
        team_code: USMS team code (e.g., "COLM")
        output_dir: Directory to save CSV files
        lmsc_id: LMSC ID (default "55" for South Carolina)
        years: List of years to scrape (default 2015-2025)
        courses: List of courses (default SCY, SCM, LCM)
        delay: Seconds to wait between requests
        headless: Run browser in headless mode
        save_debug_html: Save page HTML for debugging

    Returns:
        List of CSV file paths created
    """
    if years is None:
        years = list(range(2015, date.today().year + 1))
    if courses is None:
        courses = ["SCY", "SCM", "LCM"]

    config = ScraperConfig(
        team_code=team_code,
        output_dir=output_dir,
        lmsc_id=lmsc_id,
        years=years,
        courses=courses,
        delay_between_requests=delay,
        headless=headless,
        save_debug_html=save_debug_html,
    )

    scraper = USMSScraper(config)
    return scraper.scrape_all()
