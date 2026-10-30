from datetime import datetime, timedelta, timezone

from sqlalchemy import text

from app.db import get_engine
from tests.test_library import upload

TZ = "Europe/Berlin"


def today_at(hour: int, days_ago: int = 0) -> str:
    from zoneinfo import ZoneInfo
    local = datetime.now(ZoneInfo(TZ)).replace(hour=hour, minute=0, second=0, microsecond=0) - timedelta(days=days_ago)
    return local.astimezone(timezone.utc).isoformat()


def session(sid, book_id, days_ago, seconds, start=0.1, end=0.2, hour=9):
    return {"id": f"sess-{sid:08d}", "book_id": book_id, "format": "epub", "started_at": today_at(hour, days_ago),
            "ended_at": today_at(hour, days_ago), "seconds": seconds, "progress_start": start, "progress_end": end}


def lookup(lid, book_id, word, days_ago=0, found=True, matched=""):
    return {"id": f"look-{lid:08d}", "book_id": book_id, "language": "de", "word": word, "matched": matched,
            "dictionaries": ["duden"] if found else [], "found": found, "created_at": today_at(10, days_ago)}


def make_book(client, headers, words=10000):
    book_id = upload(client, headers, {"pdf": (b"%PDF x", "application/pdf")}, title="Die Wolke", language="de")
    client.post(f"/api/admin/books/{book_id}/commit", headers=headers)
    with get_engine().begin() as c:
        c.execute(text("UPDATE books SET word_count = :n WHERE id = :id"), {"n": words, "id": book_id})
    return book_id


def test_minutes_streak_speed_density(client, admin_headers, bucket):
    b = make_book(client, admin_headers)
    sessions = [session(1, b, 0, 600, 0.10, 0.20),   # today: 10 min, 1000 words
                session(2, b, 1, 1200, 0.20, 0.40),  # yesterday: 20 min, 2000 words
                session(3, b, 2, 300, 0.40, 0.45),   # 2 days ago
                session(4, b, 5, 900, 0.45, 0.50)]   # 5 days ago (breaks the streak)
    lookups = [lookup(1, b, "Häuser", 0, matched="Haus"), lookup(2, b, "Haus", 1, matched="Haus"),
               lookup(3, b, "Xyzzy", 1, found=False),
               lookup(4, None, "Haus", 0, matched="Haus")]  # on the Dictionary page: no book
    client.post("/api/events", headers=admin_headers, json={"sessions": sessions, "lookups": lookups})
    client.put("/api/progress", headers=admin_headers, json={"book_id": b, "format": "epub", "location": "x",
                                                             "progress": 0.5, "updated_at": "2026-10-24T10:00:00Z"})
    s = client.get("/api/stats", headers=admin_headers, params={"period": "week", "tz": TZ}).json()
    assert s["bucket"] == "day" and len(s["buckets"]) == 7
    assert s["buckets"][-1]["seconds"] == 600 and s["today_seconds"] == 600
    assert s["totals"]["seconds"] == 3000 and s["totals"]["lookups"] == 4
    assert s["streak"] == {"current": 3, "best": 3}
    [book] = s["books"]
    assert book["wpm"] == 80  # 1000 + 2000 + 500 + 500 words in 50 min
    assert book["minutes_left"] == 62  # half of 10 000 words left at 80 wpm
    assert s["density"]["de"]["per_1000"] == 0.75  # 3 lookups in 4000 words (not the Dictionary page's)
    assert s["repeated"][0]["word"] == "haus" and s["repeated"][0]["times"] == 3
    assert s["not_found"][0]["word"] == "Xyzzy"
    assert sum(map(sum, s["heatmap"])) == 3000
    assert s["goal"] is None  # off by default


def test_reading_goal_on_and_off(client, admin_headers, bucket):
    b = make_book(client, admin_headers)
    client.post("/api/events", headers=admin_headers, json={"sessions": [
        session(1, b, 1, 1500), session(2, b, 2, 300)]})
    assert client.get("/api/settings", headers=admin_headers).json()["reading_goal"]["enabled"] is False
    r = client.put("/api/settings", headers=admin_headers, json={"reading_goal": {"enabled": True, "minutes": 20, "days": [0, 1, 2, 3, 4, 5, 6, 9]}})
    assert r.json()["reading_goal"]["days"] == [0, 1, 2, 3, 4, 5, 6]  # 9 isn't a weekday
    goal = client.get("/api/stats", headers=admin_headers, params={"period": "week", "tz": TZ}).json()["goal"]
    assert goal["minutes"] == 20 and goal["days_met"] == 1 and goal["days_due"] == 6  # today doesn't count yet
    client.put("/api/settings", headers=admin_headers, json={"reading_goal": {"enabled": False, "minutes": 20}})
    assert client.get("/api/stats", headers=admin_headers, params={"tz": TZ}).json()["goal"] is None


def test_year_is_weekly_and_bad_input_is_refused(client, admin_headers):
    assert client.get("/api/stats", headers=admin_headers, params={"period": "year", "tz": TZ}).json()["bucket"] == "week"
    assert client.get("/api/stats", headers=admin_headers, params={"tz": "Mars/Base"}).status_code == 422
    assert client.get("/api/stats", headers=admin_headers, params={"period": "decade"}).status_code == 422


def test_stats_are_per_reader(client, admin_headers, auth_headers, bucket):
    b = make_book(client, admin_headers)
    client.post("/api/events", headers=admin_headers, json={"sessions": [session(1, b, 0, 600)]})
    assert client.get("/api/stats", headers=auth_headers, params={"tz": TZ}).json()["totals"]["seconds"] == 0
