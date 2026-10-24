def put(client, headers, when: str, location: str):
    return client.put("/api/progress", headers=headers, json={
        "book_id": "b1", "format": "epub", "location": location, "progress": 0.5, "updated_at": when})


def test_newest_position_wins(client, auth_headers):
    assert put(client, auth_headers, "2026-10-24T10:00:00Z", "cfi-new").json()["location"] == "cfi-new"
    # An offline device syncing an older position gets the newer one back
    assert put(client, auth_headers, "2026-10-20T10:00:00Z", "cfi-old").json()["location"] == "cfi-new"
    [pos] = client.get("/api/progress", headers=auth_headers).json()
    assert pos["location"] == "cfi-new"


def test_naive_timestamp_is_rejected(client, auth_headers):
    assert put(client, auth_headers, "2026-10-24T10:00:00", "x").status_code == 422
