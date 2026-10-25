"""Sync between devices when clocks are wrong and pulls overlap with writes."""
from datetime import datetime, timedelta, timezone

from tests.test_annotations import HL
from tests.test_learning import CARD


def iso(dt: datetime) -> str:
    return dt.isoformat().replace("+00:00", "Z")


NOW = datetime.now(timezone.utc)
FUTURE = iso(NOW + timedelta(days=2))  # a device whose clock is two days ahead


def test_a_device_clock_ahead_does_not_win_the_position_for_days(client, auth_headers):
    pos = {"book_id": "b1", "format": "epub", "progress": 0.5}
    client.put("/api/progress", headers=auth_headers, json={**pos, "location": "ahead", "updated_at": FUTURE})
    later = iso(datetime.now(timezone.utc) + timedelta(seconds=1))
    kept = client.put("/api/progress", headers=auth_headers, json={**pos, "location": "right", "updated_at": later}).json()
    assert kept["location"] == "right"
    [stored] = client.get("/api/progress", headers=auth_headers).json()
    assert stored["location"] == "right"


def test_a_device_clock_ahead_does_not_win_a_highlight_edit(client, auth_headers):
    client.put("/api/annotations/aaaaaaaa-9", headers=auth_headers, json={**HL, "note": "ahead", "client_updated_at": FUTURE})
    later = iso(datetime.now(timezone.utc) + timedelta(seconds=1))
    saved = client.put("/api/annotations/aaaaaaaa-9", headers=auth_headers,
                       json={**HL, "note": "right", "client_updated_at": later}).json()
    assert saved["note"] == "right"


def test_a_device_clock_ahead_does_not_win_a_card(client, auth_headers):
    client.put("/api/review-cards/card-00000009", headers=auth_headers,
               json={**CARD, "state": {"reps": 5}, "client_updated_at": FUTURE})
    later = iso(datetime.now(timezone.utc) + timedelta(seconds=1))
    saved = client.put("/api/review-cards/card-00000009", headers=auth_headers,
                       json={**CARD, "state": {"reps": 6}, "client_updated_at": later}).json()
    assert saved["state"]["reps"] == 6


def test_pulls_overlap_so_a_late_commit_is_not_skipped(client, auth_headers):
    client.put("/api/annotations/aaaaaaaa-8", headers=auth_headers, json=HL)
    first = client.get("/api/annotations", headers=auth_headers).json()
    # pulling again from the cursor still returns the last seconds' rows (devices merge by id)
    again = client.get("/api/annotations", headers=auth_headers, params={"since": first["cursor"]}).json()
    assert [a["id"] for a in again["annotations"]] == ["aaaaaaaa-8"]
    client.put("/api/review-cards/card-00000008", headers=auth_headers, json=CARD)
    cards = client.get("/api/review-cards", headers=auth_headers).json()
    again = client.get("/api/review-cards", headers=auth_headers, params={"since": cards["cursor"]}).json()
    assert [c["id"] for c in again["cards"]] == ["card-00000008"]
