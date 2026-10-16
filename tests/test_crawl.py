"""Tests for the shared top-10 parser and the paced crawl bookkeeping."""

# ruff: noqa: E501
# (the sample HTML below must keep each USMS result on a single line)

from datetime import datetime

from usms_scraper.crawl import LMSCS, CrawlState, results_url, unit_key
from usms_scraper.scraper import parse_top_ten_html

SAMPLE_HTML = """<html><body><pre><strong><u>Women 25-29 50 Y Freestyle </u></strong>
  1      33.58 Shea K Maize, F25, GSMS, 555D-B53P8, <a href="/comp/meets/swim.php?s=1">View</a> | <a href="/comp/meets/meet.php?MeetID=A">2025 South Carolina SCY Championship</a>
  2      38.29 Christiana Lehmann, F28, GSMS, 555J-XNWDD, <a href="/comp/meets/swim.php?s=2">View</a> | <a href="/comp/meets/meet.php?MeetID=A">2025 South Carolina SCY Championship</a>

<strong><u>Men 45-49 1650 Y Freestyle </u></strong>
  1   18:01.20 Joshua McDuffie, M48, COLM, 554U-YZFEE, <a href="/comp/meets/swim.php?s=3">View</a> | <a href="/comp/meets/meet.php?MeetID=B">Blue Tide Spooky Fall Classic</a>
</pre></body></html>"""


def test_parse_uses_club_code_from_each_line_when_no_team_given():
    records = parse_top_ten_html(SAMPLE_HTML, "SCY", 2025)
    assert [r["team"] for r in records] == ["GSMS", "GSMS", "COLM"]
    first, _, last = records
    assert first["gender"] == "W" and first["age_group"] == "25-29"
    assert first["event"] == "50 Y Freestyle" and first["time"] == "33.58"
    assert first["meet"] == "2025 South Carolina SCY Championship"
    assert last["rank"] == "1" and last["time"] == "18:01.20" and last["year"] == "2025"


def test_parse_pins_team_when_team_code_given():
    records = parse_top_ten_html(SAMPLE_HTML, "SCY", 2025, team_code="COLM")
    assert {r["team"] for r in records} == {"COLM"}


def test_parse_empty_listing():
    assert parse_top_ten_html("<html><pre></pre></html>", "LCM", 2001) == []
    assert parse_top_ten_html("<html><title>Azure WAF</title></html>", "LCM", 2001) == []


def test_results_url_matches_usms_form():
    url = results_url(2025, "LCM", "55", "COLM")
    assert url.startswith("https://www.usms.org/comp/meets/toptenlocalind.php?")
    assert "Year=2025" in url and "CourseID=2" in url and "LMSCID=55" in url
    assert "Club=COLM" in url and "ZoneID=" in url


def _state(**overrides) -> CrawlState:
    kwargs = dict(
        days=2,
        runs_per_day=1,
        start_year=2024,
        end_year=2025,
        courses=["SCY"],
        lmscs=["55", "13"],
        club_window=1,
        now=datetime(2026, 1, 1, 12, 0, 0),
    )
    kwargs.update(overrides)
    return CrawlState.new(**kwargs)


def test_pending_runs_all_phase1_before_any_phase2():
    state = _state()
    pending = state.pending_units()
    assert len(pending) == 8  # 2 LMSCs x 2 years x 1 course, twice
    assert [p for p, _ in pending] == [1] * 4 + [2] * 4
    state.phase1_done.append(unit_key("55", 2024, "SCY"))
    assert (1, "55:2024:SCY") not in state.pending_units()


def test_club_window_and_phase2_estimate():
    state = _state()
    state.record_clubs("55", 2024, {"COLM", "GSMS"})
    state.record_clubs("55", 2025, {"COLM"})
    assert state.clubs_for("55", 2025) == ["COLM", "GSMS"]  # GSMS seen within 1 year
    state.club_window = 0
    assert state.clubs_for("55", 2025) == ["COLM"]
    state.club_window = -1
    assert state.clubs_for("55", 2025) == ["COLM", "GSMS"]

    # Phase 2 cost is unknown until phase 1 finishes for that LMSC.
    for y in (2024, 2025):
        state.phase1_done.append(unit_key("55", y, "SCY"))
    assert state.phase1_complete("55") and not state.phase1_complete("13")
    assert state.estimate_requests(2, "55:2025:SCY") == 2


def test_budget_spreads_remaining_work_over_runs_left():
    state = _state()
    now = datetime(2026, 1, 1, 12, 0, 0)
    # 4 phase-1 requests + 4 phase-2 units x default estimate (20) = 84, over 2 runs.
    assert state.remaining_requests() == 84
    assert state.runs_remaining(now) == 2
    assert state.budget_for_run(now) == 42
    # Past the deadline everything left is due now.
    assert state.budget_for_run(datetime(2026, 2, 1)) == 84


def test_failed_units_are_skipped_after_three_failures():
    state = _state()
    state.failures["55:2024:SCY"] = 3
    units = [u for _, u in state.pending_units()]
    assert "55:2024:SCY" not in units
    assert "55:2024:SCY" in state.progress()["failed_units"]


def test_lmsc_table_has_every_form_option():
    assert len(LMSCS) == 51
    assert LMSCS["55"] == "South Carolina" and LMSCS["38"] == "Pacific"
