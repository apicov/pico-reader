import boto3

from app import r2_copy


def test_copies_everything_once_with_its_type_and_reports_what_is_missing(s3_server, tmp_path):
    s3 = boto3.client("s3", endpoint_url=s3_server, aws_access_key_id="test", aws_secret_access_key="test",
                      region_name="us-east-1")
    for name in ("copy-from", "copy-to"):
        if not any(b["Name"] == name for b in s3.list_buckets()["Buckets"]):
            s3.create_bucket(Bucket=name)
    s3.put_object(Bucket="copy-from", Key="books/a/epub-1.epub", Body=b"x" * 2000, ContentType="application/epub+zip")
    s3.put_object(Bucket="copy-from", Key="backups/reader.sql.gz", Body=b"gz", ContentType="application/gzip",
                  CacheControl="no-cache")
    files = []
    for name in ("copy-from", "copy-to"):
        env = tmp_path / f"{name}.env"
        env.write_text(f"R2_ENDPOINT={s3_server}\nR2_ACCESS_KEY_ID=test\nR2_SECRET_ACCESS_KEY='test'\nR2_BUCKET={name}\n# a comment\n")
        files.append(r2_copy.bucket_of(r2_copy.read_env(env)))
    source, target = files

    assert r2_copy.copy(source, target, log=lambda _: None) == {"copied": 2, "skipped": 0, "missing": 0}
    head = s3.head_object(Bucket="copy-to", Key="books/a/epub-1.epub")
    assert head["ContentType"] == "application/epub+zip" and head["ContentLength"] == 2000
    assert s3.head_object(Bucket="copy-to", Key="backups/reader.sql.gz")["CacheControl"] == "no-cache"
    assert r2_copy.copy(source, target, log=lambda _: None) == {"copied": 0, "skipped": 2, "missing": 0}  # again: nothing

    s3.put_object(Bucket="copy-from", Key="books/b/new.pdf", Body=b"new")  # uploaded meanwhile
    assert r2_copy.copy(source, target, log=lambda _: None)["copied"] == 1

    class Failing:  # a destination that loses what's put in it
        def __init__(self, client):
            self.client = client

        def __getattr__(self, name):
            return getattr(self.client, name)

        def put_object(self, **kw):
            return None
    s3.put_object(Bucket="copy-from", Key="books/c/lost.pdf", Body=b"lost")
    log = []
    assert r2_copy.copy(source, (Failing(target[0]), "copy-to"), log=log.append)["missing"] == 1
    assert "MISSING books/c/lost.pdf" in log
