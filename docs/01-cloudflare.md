# 01 — Cloudflare

Everything here is in the Cloudflare account `c10b6d4948424c31eab1b0cd8137caa2` (the main app account).

## 1. The bucket

R2 → **Create bucket** → name `pico-library`, location automatic, standard storage. Leave public access
**off**: every download goes through a signed link.

## 2. The token

R2 → **Manage API tokens** → **Create API token**:

- Permissions: **Object Read & Write**
- Apply to: **specific bucket** → `pico-library` only
- TTL: forever

Note the **Access Key ID** and **Secret Access Key** (shown once). They become `R2_ACCESS_KEY_ID` and
`R2_SECRET_ACCESS_KEY` in [04](04-backend.md). Keep a copy in `~/tsp-configs/pico-reader/r2.env`.

Check the token before using it: it must list, upload and delete in `pico-library`:

```bash
set -a; . ~/tsp-configs/pico-reader/r2.env; set +a
python3 - <<'PY'
import os, boto3
s = boto3.client("s3", endpoint_url=f"https://{os.environ['R2_ACCOUNT_ID']}.r2.cloudflarestorage.com",
                 aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],
                 aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"], region_name="auto")
s.put_object(Bucket="pico-library", Key="_check.txt", Body=b"ok")
print(s.list_objects_v2(Bucket="pico-library", MaxKeys=1)["KeyCount"])
s.delete_object(Bucket="pico-library", Key="_check.txt")
PY
```

This token cannot change bucket settings; CORS is set in the dashboard (next step).

## 3. CORS

Browsers only fetch from R2 when the bucket allows the page's origin. R2 → `pico-library` → **Settings** →
**CORS Policy** → **Edit**:

```json
[
  {
    "AllowedOrigins": ["https://books.apicov.xyz", "http://localhost:5173", "https://localhost", "capacitor://localhost"],
    "AllowedMethods": ["GET", "PUT", "HEAD"],
    "AllowedHeaders": ["*"],
    "MaxAgeSeconds": 3600
  }
]
```

`https://books.apicov.xyz` is the web app, `http://localhost:5173` local development, the other two the
Android app's WebView. Check it with a preflight; the answer must be `204`:

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X OPTIONS \
  "https://c10b6d4948424c31eab1b0cd8137caa2.r2.cloudflarestorage.com/pico-library/x" \
  -H "Origin: https://books.apicov.xyz" -H "Access-Control-Request-Method: GET"
```

## 4. Email sender

Sign-in codes are sent with **Cloudflare Email Sending** from `noreply@thestitchpatterns.store`, a domain
already onboarded for sending in this account (Email → Email Sending). Any domain onboarded there works;
set it as `EMAIL_FROM`.

The API token: My Profile → **API Tokens** → **Create token** → custom token with the permission
**Account → Email Sending → Edit** for this account. It becomes `CLOUDFLARE_EMAIL_API_TOKEN`, and the account
id `CLOUDFLARE_ACCOUNT_ID`.
