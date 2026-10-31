"""Copy a database dump to R2 and drop copies older than the retention, run by deploy/backup-db.sh:

    python -m app.offsite_backup /home/tsp/backups/pico-reader/reader-20270101.sql.gz
"""

import os
import sys
from datetime import UTC, datetime, timedelta

from app import r2
from app.config import get_settings

PREFIX = "backups/"
KEEP_DAYS = 30


def destination():
    """The backups' own bucket and token when set (BACKUP_*), else the library's."""
    s = get_settings()
    if s.backup_bucket:
        return r2.client_for(s.r2_account_id, s.backup_access_key_id, s.backup_secret_access_key, s.r2_endpoint), s.backup_bucket
    return r2.get_client(), s.r2_bucket


def main(path: str) -> None:
    client, bucket = destination()
    key = PREFIX + os.path.basename(path)
    client.upload_file(path, bucket, key)
    print(f"uploaded {key}")
    cutoff = datetime.now(UTC) - timedelta(days=KEEP_DAYS)
    for page in client.get_paginator("list_objects_v2").paginate(Bucket=bucket, Prefix=PREFIX):
        for obj in page.get("Contents", []):
            if obj["LastModified"] < cutoff:
                client.delete_object(Bucket=bucket, Key=obj["Key"])
                print(f"deleted {obj['Key']}")


if __name__ == "__main__":
    main(sys.argv[1])
