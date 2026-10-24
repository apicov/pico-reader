"""Copy a database dump to R2 and drop copies older than the retention, run by deploy/backup-db.sh:

    python -m app.offsite_backup /home/tsp/backups/pico-reader/reader-20270101.sql.gz
"""

import os
import sys
from datetime import datetime, timedelta, timezone

from app import r2
from app.config import get_settings

PREFIX = "backups/"
KEEP_DAYS = 30


def main(path: str) -> None:
    client, bucket = r2.get_client(), get_settings().r2_bucket
    key = PREFIX + os.path.basename(path)
    client.upload_file(path, bucket, key)
    print(f"uploaded {key}")
    cutoff = datetime.now(timezone.utc) - timedelta(days=KEEP_DAYS)
    for page in client.get_paginator("list_objects_v2").paginate(Bucket=bucket, Prefix=PREFIX):
        for obj in page.get("Contents", []):
            if obj["LastModified"] < cutoff:
                client.delete_object(Bucket=bucket, Key=obj["Key"])
                print(f"deleted {obj['Key']}")


if __name__ == "__main__":
    main(sys.argv[1])
