"""Tests for the experimental SwimJSON ingest (see SWIMJSON.md)."""

from datetime import date
from pathlib import Path

from usms_scraper import swimjson

FIXTURE = Path(__file__).parent / "fixtures" / "swimjson" / "sample_scy_meet.json"


def _rows():
    return swimjson.document_to_rows(swimjson.load_document(FIXTURE))


def test_converts_individual_swims_to_record_rows():
    report = _rows()
    by_id = {(r["swimmer"], r["event"]): r for r in report.rows}
    pat = by_id[("Pat Swimmer", "50 Y Freestyle")]
    assert pat["team"] == "COLM" and pat["gender"] == "W" and pat["course"] == "SCY"
    assert pat["age_group"] == "45-49"  # 45 on 2026-10-17 (birthday Dec 1)
    assert pat["year"] == "2027"  # an October SCY swim counts toward the next season
    assert pat["meet"] == "Test Fall Classic" and pat["date"] == "2026-10-17"
    assert pat["swimmer_id"] == "ABCDE"
    # Mixed (X) event: sex comes from the athlete; MEDLEY -> Individual Medley
    lee = by_id[("Lee Fast", "100 Y Individual Medley")]
    assert lee["gender"] == "M" and lee["team"] == "GSMS" and lee["age_group"] == "50-54"


def test_skips_relays_exhibitions_dq_and_scy_without_birth_date():
    report = _rows()
    names = {r["swimmer"] for r in report.rows}
    assert "Kim Yearonly" not in names  # SCY age needs a full birth date
    assert report.skipped["relay"] == 1
    assert report.skipped["exhibition/time trial"] == 1
    assert report.skipped["status DSQ"] == 1
    assert len(report.rows) == 4


def test_usms_age_and_season_rules():
    assert swimjson.usms_age("LCM", None, 1980, date(2026, 7, 1)) == 46  # age on Dec 31
    assert swimjson.usms_age("SCY", date(1980, 12, 1), 1980, date(2026, 11, 30)) == 45
    assert swimjson.usms_age("SCY", None, 1980, date(2026, 11, 30)) is None
    assert swimjson.season_year("SCY", date(2026, 5, 31)) == 2026
    assert swimjson.season_year("SCY", date(2026, 6, 1)) == 2027
    assert swimjson.season_year("LCM", date(2026, 12, 31)) == 2026
    assert swimjson.age_group_for(17) is None and swimjson.age_group_for(24) == "18-24"


def _row(team, swimmer, time, rank="", sid=""):
    return {
        "team": team,
        "event": "50 Y Freestyle",
        "course": "SCY",
        "gender": "W",
        "age_group": "45-49",
        "time": time,
        "swimmer": swimmer,
        "date": "",
        "meet": "m",
        "year": "2027",
        "rank": rank,
        "swimmer_id": sid,
    }


def test_merge_reranks_dedupes_and_keeps_best_per_swimmer():
    existing = [_row("COLM", "A", "30.00", "1", "AAAAA"), _row("COLM", "B", "31.00", "2", "BBBBB")]
    incoming = [
        _row("COLM", "C", "29.50", sid="CCCCC"),  # new #1
        _row("COLM", "A", "30.00", sid="AAAAA"),  # same swim again: ignored
        _row("COLM", "B", "30.50", sid="BBBBB"),  # B improves: replaces their old row
    ]
    merged = swimjson.merge_top_n(existing, incoming)
    assert [(r["swimmer"], r["time"], r["rank"]) for r in merged] == [
        ("C", "29.50", "1"),
        ("A", "30.00", "2"),
        ("B", "30.50", "3"),
    ]
    # Re-ingesting is a no-op
    again = swimjson.merge_top_n(merged, incoming)
    assert [(r["swimmer"], r["rank"]) for r in again] == [(r["swimmer"], r["rank"]) for r in merged]


def test_merge_across_clubs_for_state_top10_and_ties():
    rows = [_row("COLM", "A", "30.00", sid="A"), _row("GSMS", "B", "30.00", sid="B")]
    per_club = swimjson.merge_top_n([], rows, by_team=True)
    assert [r["rank"] for r in per_club] == ["1", "1"]  # separate slots
    state = swimjson.merge_top_n([], rows + [_row("GS", "C", "29.00", sid="C")], by_team=False)
    assert [(r["swimmer"], r["rank"]) for r in state] == [("C", "1"), ("A", "2"), ("B", "2")]
