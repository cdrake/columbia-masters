"""normalize_tab must pass event urls through unchanged, incl. the "team-store" keyword."""

from usms_scraper.sheet_sync import normalize_tab


def test_events_keep_team_store_keyword_and_plain_urls():
    rows = [
        {"date": "2026-12-01", "title": "Suit sale", "url": " team-store "},
        {"date": "2026-12-05", "title": "Meet", "url": "https://x.org/meet"},
    ]
    assert [e["url"] for e in normalize_tab("events", rows)] == ["team-store", "https://x.org/meet"]
