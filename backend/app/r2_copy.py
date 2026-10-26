"""Copies every object of one R2 bucket into another, e.g. into a bucket on another Cloudflare account, with
the same keys (the database refers to files by key), content types and cache headers. An object already there
with the same size is skipped, so running it again only copies what's new. Ends by checking that every object
is there, the same size; exits 1 if not.

    python -m app.r2_copy FROM.env TO.env

Each file holds R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET (and R2_ENDPOINT in tests).
Moving the app to the other bucket: docs/08-operations.md."""

import sys
from pathlib import Path

from app import r2


def read_env(path: Path) -> dict[str, str]:
    out = {}
    for line in path.read_text().splitlines():
        key, sep, value = line.strip().partition("=")
        if sep and not key.startswith("#"):
            out[key.strip()] = value.strip().strip('"').strip("'")
    return out


def bucket_of(env: dict[str, str]):
    """(client, bucket name) for one env file's R2 settings."""
    client = r2.client_for(env.get("R2_ACCOUNT_ID", ""), env.get("R2_ACCESS_KEY_ID", ""),
                           env.get("R2_SECRET_ACCESS_KEY", ""), env.get("R2_ENDPOINT", ""))
    return client, env.get("R2_BUCKET", "pico-library")


def objects(client, bucket: str) -> dict[str, int]:
    """{key: size} of everything in the bucket."""
    out = {}
    for page in client.get_paginator("list_objects_v2").paginate(Bucket=bucket):
        out.update({o["Key"]: o["Size"] for o in page.get("Contents", [])})
    return out


def copy(source, target, log=print) -> dict[str, int]:
    """`source`, `target`: (client, bucket). Returns {'copied', 'skipped', 'missing'} counts."""
    (src, src_bucket), (dst, dst_bucket) = source, target
    wanted, present = objects(src, src_bucket), objects(dst, dst_bucket)
    copied = skipped = 0
    for key, size in sorted(wanted.items()):
        if present.get(key) == size:
            skipped += 1
            continue
        obj = src.get_object(Bucket=src_bucket, Key=key)
        extra = {k: obj[k] for k in ("ContentType", "CacheControl", "ContentDisposition") if obj.get(k)}
        dst.put_object(Bucket=dst_bucket, Key=key, Body=obj["Body"].read(), **extra)
        copied += 1
        log(f"copied {key} ({size / 1e6:.1f} MB)")
    after = objects(dst, dst_bucket)
    missing = [k for k, size in wanted.items() if after.get(k) != size]
    for key in missing:
        log(f"MISSING {key}")
    return {"copied": copied, "skipped": skipped, "missing": len(missing)}


def main() -> None:
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    source, target = (bucket_of(read_env(Path(p))) for p in sys.argv[1:])
    done = copy(source, target)
    print(f"{done['copied']} copied, {done['skipped']} already there, {done['missing']} missing")
    sys.exit(1 if done["missing"] else 0)


if __name__ == "__main__":
    main()
