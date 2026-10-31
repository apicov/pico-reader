from app import offsite_backup
from app.config import get_settings


def test_dumps_go_to_their_own_bucket_when_set(bucket, monkeypatch, tmp_path):
    bucket.create_bucket(Bucket="test-backups")
    monkeypatch.setenv("BACKUP_BUCKET", "test-backups")
    monkeypatch.setenv("BACKUP_ACCESS_KEY_ID", "backup")
    monkeypatch.setenv("BACKUP_SECRET_ACCESS_KEY", "backup")
    get_settings.cache_clear()
    dump = tmp_path / "reader-20261031.sql.gz"
    dump.write_bytes(b"dump")
    offsite_backup.main(str(dump))
    assert [o["Key"] for o in bucket.list_objects_v2(Bucket="test-backups")["Contents"]] == ["backups/reader-20261031.sql.gz"]
    assert "Contents" not in bucket.list_objects_v2(Bucket="test-library")


def test_without_a_backup_bucket_dumps_go_with_the_books(bucket, tmp_path):
    dump = tmp_path / "reader-20261031.sql.gz"
    dump.write_bytes(b"dump")
    offsite_backup.main(str(dump))
    assert [o["Key"] for o in bucket.list_objects_v2(Bucket="test-library")["Contents"]] == ["backups/reader-20261031.sql.gz"]
