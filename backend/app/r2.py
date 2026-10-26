"""Cloudflare R2: short-lived signed links, the same flow as the tracker (backend/utils/r2.py).

1. The app asks an authenticated endpoint for a file
2. The backend checks the token and signs a short-lived URL for that one object
3. The app downloads (or the desktop tool uploads) straight from/to R2; the server never streams files
"""

from functools import lru_cache

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError

from app.config import get_settings  # noqa: F401 (re-exported for callers)


def client_for(account_id: str, access_key_id: str, secret_access_key: str, endpoint: str = ""):
    """An S3 client for an R2 account (or `endpoint`, e.g. moto in tests)."""
    if not (access_key_id and secret_access_key and (endpoint or account_id)):
        raise RuntimeError("R2 is not configured: set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY")
    return boto3.client(
        "s3",
        endpoint_url=endpoint or f"https://{account_id}.r2.cloudflarestorage.com",
        aws_access_key_id=access_key_id,
        aws_secret_access_key=secret_access_key,
        config=Config(signature_version="s3v4"),
        region_name="auto",
    )


@lru_cache
def get_client():
    s = get_settings()
    return client_for(s.r2_account_id, s.r2_access_key_id, s.r2_secret_access_key, s.r2_endpoint)


def download_url(key: str) -> str:
    s = get_settings()
    return get_client().generate_presigned_url(
        "get_object", Params={"Bucket": s.r2_bucket, "Key": key}, ExpiresIn=s.download_url_seconds)


def upload_url(key: str, content_type: str) -> str:
    """The uploader must send the same Content-Type header, it is part of the signature."""
    s = get_settings()
    return get_client().generate_presigned_url(
        "put_object", Params={"Bucket": s.r2_bucket, "Key": key, "ContentType": content_type},
        ExpiresIn=s.upload_url_seconds)


def object_size(key: str) -> int | None:
    """Size of an uploaded object, None when it isn't there."""
    try:
        head = get_client().head_object(Bucket=get_settings().r2_bucket, Key=key)
    except ClientError:
        return None
    return head["ContentLength"]


def delete_key(key: str) -> None:
    get_client().delete_object(Bucket=get_settings().r2_bucket, Key=key)


def delete_prefix(prefix: str) -> None:
    client, bucket = get_client(), get_settings().r2_bucket
    for page in client.get_paginator("list_objects_v2").paginate(Bucket=bucket, Prefix=prefix):
        keys = [{"Key": o["Key"]} for o in page.get("Contents", [])]
        if keys:
            client.delete_objects(Bucket=bucket, Delete={"Objects": keys})
